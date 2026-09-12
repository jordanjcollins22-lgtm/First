-- The county import cannot drive itself on Vercel.
--
-- A function that posts to its own deployment to start the next page is a
-- loop, and after a few hops the platform answers 508 and stops it. So the
-- next page is asked for from outside the deployment: Postgres, on a
-- schedule, posts to the step route for every import that is running and
-- not currently being worked on. The database was already the record of
-- where each import had got to; now it is also what keeps it moving.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- A step needs to prove it was asked for by us. Rather than share the app's
-- cron secret with the database, each job carries its own random token that
-- authorises exactly one thing: running one more step of that job.
ALTER TABLE gis_import_jobs ADD COLUMN IF NOT EXISTS tick_token TEXT;

-- Where the deployed app answers. Written by the app when an import starts,
-- from the request that started it, so a preview and production each drive
-- their own.
CREATE TABLE IF NOT EXISTS gis_import_settings (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  base_url TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One tick: ask for a step on every runnable import. Fire-and-forget; the
-- route answers 202 at once and does the work after. Returns how many were
-- asked, which is nearly always zero.
CREATE OR REPLACE FUNCTION gis_import_tick()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  job RECORD;
  asked INTEGER := 0;
BEGIN
  FOR job IN
    SELECT j.id, j.tick_token, s.base_url
    FROM gis_import_jobs j
    JOIN gis_import_settings s ON s.organization_id = j.organization_id
    WHERE j.status = 'running'
      AND j.tick_token IS NOT NULL
      AND (j.lease_until IS NULL OR j.lease_until < now())
  LOOP
    PERFORM net.http_post(
      url := job.base_url || '/api/gis-import/step',
      body := jsonb_build_object('jobId', job.id, 'token', job.tick_token),
      headers := '{"content-type": "application/json"}'::jsonb,
      timeout_milliseconds := 10000
    );
    asked := asked + 1;
  END LOOP;
  RETURN asked;
END;
$$;

-- Every thirty seconds. Re-running this file replaces the schedule rather
-- than adding a second one.
DO $$
BEGIN
  PERFORM cron.unschedule('gis-import-tick');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;
SELECT cron.schedule('gis-import-tick', '30 seconds', 'SELECT public.gis_import_tick()');

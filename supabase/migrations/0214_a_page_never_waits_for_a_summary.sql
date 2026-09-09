-- A page never waits for a summary to be recomputed.
--
-- 0206 split the summaries into light ones (refreshed every half hour) and
-- heavy ones (refreshed once a day), which took the cron down from about a
-- hundred and fifteen seconds an hour to almost nothing. It also left a hole,
-- and this is it: summary_get still treated anything older than forty-five
-- minutes as stale and recomputed it *inside the request that asked for it*.
--
-- So from 09:45 every morning, the first person to open a page paid for the
-- recompute. Measured on this database before the fix:
--
--   ownership_summary              11.7 s
--   houses_map_points               8.1 s
--   zones_list                      3.5 s
--   zones_geojson                   1.8 s
--   relationship_ownership_matrix   0.8 s
--
-- The Marketing tab reads four of those, so opening it after a break was
-- roughly sixteen seconds. Then it went quiet for forty-five minutes and did
-- it again -- which is exactly what "closing and reopening is slow" feels like
-- from the other side of the screen.
--
-- Two changes.
--
-- **The staleness window matches how often the thing is actually refreshed.**
-- Forty-five minutes was right when everything was refreshed every thirty; for
-- a summary the cron rebuilds a few times a day it is a guarantee that most
-- reads are rebuilds. Light keys keep forty-five minutes. Heavy keys get a day
-- and two hours -- long enough to cover the gap between runs without ever being
-- the reason a page is slow.
--
-- **A heavy summary that exists is served, full stop.** Not recomputed, however
-- old it is. A map drawn from this morning's data beats a map drawn from this
-- minute's data in eight seconds' time, and it is not close. The only
-- exceptions are the two cases where stale would be worse than slow: there is
-- no cached value at all (the first ever load, which has to compute something),
-- or the value is more than three days old, which does not mean "busy", it
-- means the cron has stopped and somebody should find out.
--
-- Callers that genuinely need fresher than this pass max_age themselves and
-- still get exactly what they ask for. Nothing does today.

CREATE OR REPLACE FUNCTION public.summary_get(org uuid, the_key text, max_age interval DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c RECORD;
  heavy BOOLEAN;
  window_age INTERVAL;
BEGIN
  PERFORM assert_own_org(org);
  heavy := the_key = ANY (summary_keys_heavy());

  -- What the caller asked for, or what this key's own refresh cadence makes
  -- reasonable. Derived rather than hard-coded so that moving a key between
  -- the light and heavy lists moves its freshness window with it.
  window_age := coalesce(max_age, CASE WHEN heavy THEN interval '26 hours' ELSE interval '45 minutes' END);

  SELECT value, computed_at INTO c FROM summary_cache WHERE organization_id = org AND key = the_key;

  IF c.value IS NOT NULL AND c.computed_at > now() - window_age THEN
    RETURN c.value;
  END IF;

  -- Stale, but a heavy summary that exists is still worth more than the wait
  -- to rebuild it. The caller did not ask for it fresh, and the cron will have
  -- it by the next run.
  IF heavy AND c.value IS NOT NULL AND max_age IS NULL AND c.computed_at > now() - interval '3 days' THEN
    RETURN c.value;
  END IF;

  RETURN summary_refresh(org, the_key);
END $function$;

-- Four-hourly rather than daily: close enough that nobody reads yesterday's
-- map, and off the read path either way.
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'summaries-refresh-heavy'),
  schedule := '0 */4 * * *'
);

NOTIFY pgrst, 'reload schema';

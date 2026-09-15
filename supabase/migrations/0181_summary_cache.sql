-- County-wide answers, kept rather than recomputed on every page.
--
-- The ownership counts, the cross-check table, the kinds of door, the zone
-- list and outlines, the houses off any route, and every address as a
-- point are each an answer over 117,000 houses. They change when an
-- import or a build runs, or a client is made, and not otherwise, yet
-- every page open was working all of them out again, in parallel, on a
-- small database. Now each is worked out once, kept here, and read back
-- in a millisecond. A ten-minute cron keeps them fresh, and the things
-- that change them (a build finishing, a client's plays being made) ask
-- for a refresh of the answers they touched.

CREATE TABLE IF NOT EXISTS public.summary_cache (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  took_ms INTEGER,
  PRIMARY KEY (organization_id, key)
);

CREATE OR REPLACE FUNCTION public.summary_keys()
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['ownership_summary', 'relationship_ownership_matrix', 'kind_summary', 'zones_list', 'zones_geojson',
               'eddm_unserved_cells', 'houses_map_points', 'houses_unserved_points'];
$$;

CREATE OR REPLACE FUNCTION public.summary_compute(org UUID, the_key TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
BEGIN
  RETURN CASE the_key
    WHEN 'ownership_summary' THEN ownership_summary(org)
    WHEN 'relationship_ownership_matrix' THEN relationship_ownership_matrix(org)
    WHEN 'kind_summary' THEN kind_summary(org)
    WHEN 'zones_list' THEN zones_list(org)
    WHEN 'zones_geojson' THEN zones_geojson(org)
    WHEN 'eddm_unserved_cells' THEN eddm_unserved_cells(org)
    WHEN 'houses_map_points' THEN houses_map_points(org)
    WHEN 'houses_unserved_points' THEN houses_unserved_points(org)
    ELSE NULL
  END;
END $$;

CREATE OR REPLACE FUNCTION public.summary_refresh(org UUID, the_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE t0 TIMESTAMPTZ := clock_timestamp(); v JSONB;
BEGIN
  v := summary_compute(org, the_key);
  INSERT INTO summary_cache (organization_id, key, value, computed_at, took_ms)
  VALUES (org, the_key, v, now(), (extract(epoch FROM clock_timestamp() - t0) * 1000)::integer)
  ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value, computed_at = EXCLUDED.computed_at, took_ms = EXCLUDED.took_ms;
  RETURN v;
END $$;

-- Every answer, or the ones named. Returns how long each took.
CREATE OR REPLACE FUNCTION public.summaries_refresh(org UUID, keys TEXT[] DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE k TEXT; took JSONB := '{}'::jsonb; t0 TIMESTAMPTZ;
BEGIN
  FOREACH k IN ARRAY coalesce(keys, summary_keys()) LOOP
    t0 := clock_timestamp();
    PERFORM summary_refresh(org, k);
    took := took || jsonb_build_object(k, (extract(epoch FROM clock_timestamp() - t0) * 1000)::integer);
  END LOOP;
  RETURN took;
END $$;

-- The kept answer, or a fresh one when there is none or it is older than
-- the cron should ever let it get.
CREATE OR REPLACE FUNCTION public.summary_get(org UUID, the_key TEXT, max_age INTERVAL DEFAULT '45 minutes')
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE c RECORD;
BEGIN
  SELECT value, computed_at INTO c FROM summary_cache WHERE organization_id = org AND key = the_key;
  IF c.value IS NOT NULL AND c.computed_at > now() - max_age THEN RETURN c.value; END IF;
  RETURN summary_refresh(org, the_key);
END $$;

-- New plays can make a zone one the office needs to see.
CREATE OR REPLACE FUNCTION public.marketing_sync_and_refresh(org UUID)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE r JSONB;
BEGIN
  r := marketing_sync(org);
  IF coalesce((r->>'made')::integer, 0) > 0 THEN
    PERFORM summaries_refresh(org, ARRAY['zones_list', 'zones_geojson']);
  END IF;
  RETURN r;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketing-sync') THEN PERFORM cron.unschedule('marketing-sync'); END IF;
    PERFORM cron.schedule('marketing-sync', '*/5 * * * *', 'SELECT public.marketing_sync_and_refresh(id) FROM public.organizations');
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'summaries-refresh') THEN PERFORM cron.unschedule('summaries-refresh'); END IF;
    PERFORM cron.schedule('summaries-refresh', '*/10 * * * *', 'SELECT public.summaries_refresh(id) FROM public.organizations');
  END IF;
END $$;

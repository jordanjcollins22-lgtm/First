-- The planner is kept told about the big tables.
--
-- `houses` is a hundred and fifty-four megabytes and had never been analysed --
-- last_analyze and last_autoanalyze both null -- so every plan touching it was
-- guesswork. It showed. Analysing the reporting tables, with no other change:
--
--   ownership_summary   11.7 s -> 3.1 s
--   houses_map_points    8.1 s -> 3.0 s
--   all seven heavy      ~26 s -> ~11 s
--
-- Autovacuum should do this and evidently has not, on tables written in big
-- county-sized batches and then read for months. So rather than hope, the
-- analyse runs immediately before the heavy summaries computed from it: the
-- statistics are always fresher than the thing being derived from them, and
-- one cron entry keeps both true.
--
-- It skips anything analysed in the last twenty hours. The heavy refresh runs
-- every four hours and the statistics do not need rebuilding that often --
-- road_segments alone is five and a half seconds, for a table that changes
-- only when the county is re-imported.

CREATE OR REPLACE FUNCTION public.analyze_reporting_tables(older_than interval DEFAULT interval '20 hours')
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE t TEXT; done INTEGER := 0; last_at TIMESTAMPTZ;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'houses', 'zone_houses', 'house_ownership', 'house_kinds', 'house_contacts',
    'attractor_waves', 'eddm_routes', 'eddm_segments', 'road_segments',
    'hanger_zones', 'canvas_designs', 'customers', 'properties', 'jobs',
    'property_events', 'marketing_plays', 'payments', 'time_entries'
  ] LOOP
    BEGIN
      SELECT greatest(coalesce(last_analyze, '-infinity'), coalesce(last_autoanalyze, '-infinity'))
        INTO last_at
      FROM pg_stat_user_tables WHERE schemaname = 'public' AND relname = t;

      CONTINUE WHEN last_at IS NOT NULL AND last_at > now() - older_than;

      EXECUTE format('ANALYZE public.%I', t);
      done := done + 1;
    EXCEPTION WHEN OTHERS THEN
      -- A table that has gone away must not stop the rest being analysed.
      RAISE WARNING 'analyze_reporting_tables: % failed: %', t, SQLERRM;
    END;
  END LOOP;
  RETURN done;
END $function$;

-- The statistics, then the summaries computed from them, in that order. One
-- organisation failing must not cost the others their refresh.
CREATE OR REPLACE FUNCTION public.summaries_refresh_heavy_all()
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE o UUID;
BEGIN
  PERFORM analyze_reporting_tables();
  FOR o IN SELECT id FROM organizations LOOP
    BEGIN
      PERFORM summaries_refresh_heavy(o);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'summaries_refresh_heavy_all: org % failed: %', o, SQLERRM;
    END;
  END LOOP;
END $function$;

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'summaries-refresh-heavy'),
  command := 'SELECT public.summaries_refresh_heavy_all()'
);

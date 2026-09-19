-- The half-minute of database work that ran twice an hour.
--
-- summaries-refresh recomputed all nine summaries for every business every
-- thirty minutes, and it was taking between fifty-seven and ninety-four
-- seconds each time. On a shared instance that is the whole machine, twice an
-- hour, and every page anybody opened during it queued behind it. That is what
-- "the app is slow" was.
--
-- Almost none of it needed doing that often. Measured, per refresh:
--
--   houses_map_points              58s   4.5 MB   every mappable house
--   relationship_ownership_matrix  19s   407 B    counts over 117k houses
--   ownership_summary               9s   164 B    counts over 117k houses
--   zones_list                      7s   144 kB
--   eddm_unserved_cells             3s
--   zones_geojson                   3s
--   houses_unserved_points          2s
--   ops_pulse                     0.4s   the only one about today
--   kind_summary                 0.04s
--
-- Everything above ops_pulse describes the county dataset: it changes when an
-- import runs or when zones are re-walked, not while somebody is working. The
-- two that describe today are cheap.
--
-- So the thirty-minute job now refreshes only those two, and takes about
-- seven tenths of a second. The rest runs once, at nine in the morning UTC,
-- which is before five Eastern -- the county data is at most a day old, which
-- is newer than the county's own.
--
-- The zones are not left stale by this: zones_rewalk_tick already refreshes
-- zones_list and zones_geojson itself the moment its queue empties.

CREATE OR REPLACE FUNCTION public.summary_keys_light()
RETURNS TEXT[] LANGUAGE sql IMMUTABLE SET search_path = public
AS $fn$ SELECT ARRAY['ops_pulse','kind_summary']::text[] $fn$;

CREATE OR REPLACE FUNCTION public.summary_keys_heavy()
RETURNS TEXT[] LANGUAGE sql IMMUTABLE SET search_path = public
AS $fn$ SELECT ARRAY[
  'ownership_summary','relationship_ownership_matrix',
  'zones_list','zones_geojson','eddm_unserved_cells',
  'houses_map_points','houses_unserved_points'
]::text[] $fn$;

CREATE OR REPLACE FUNCTION public.summaries_refresh_light(org UUID)
RETURNS JSONB LANGUAGE sql SET search_path = public, pg_temp
AS $fn$ SELECT summaries_refresh(org, summary_keys_light()); $fn$;

CREATE OR REPLACE FUNCTION public.summaries_refresh_heavy(org UUID)
RETURNS JSONB LANGUAGE sql SET search_path = public, pg_temp
AS $fn$ SELECT summaries_refresh(org, summary_keys_heavy()); $fn$;

REVOKE ALL ON FUNCTION public.summaries_refresh_light(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.summaries_refresh_heavy(UUID) FROM PUBLIC, anon;

-- cron.unschedule throws where the job is missing, so this is written to be
-- safe to run on a database that has already had it applied.
DO $do$ BEGIN
  PERFORM cron.unschedule('summaries-refresh');
EXCEPTION WHEN OTHERS THEN NULL; END $do$;
DO $do$ BEGIN
  PERFORM cron.unschedule('summaries-refresh-heavy');
EXCEPTION WHEN OTHERS THEN NULL; END $do$;

SELECT cron.schedule('summaries-refresh', '*/30 * * * *',
  $job$ SELECT public.summaries_refresh_light(id) FROM public.organizations $job$);

SELECT cron.schedule('summaries-refresh-heavy', '0 9 * * *',
  $job$ SELECT public.summaries_refresh_heavy(id) FROM public.organizations $job$);

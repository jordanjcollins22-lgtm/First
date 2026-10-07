-- Make autovacuum actually look at the county tables.
--
-- These are loaded in one enormous import and then read for months. Nothing
-- updates or deletes rows in them, so they generate almost no dead tuples --
-- and dead tuples are what the default autovacuum thresholds watch. The result
-- was a hundred and seventeen thousand houses in a hundred and fifty-four
-- megabytes that had never been vacuumed or analysed at all: last_vacuum,
-- last_autovacuum, last_analyze and last_autoanalyze were all null.
--
-- The cost of that was not subtle. A plain count of houses, which the Address
-- Review page does four times, took 4,486 ms, because with no vacuum the
-- visibility map is empty and Postgres cannot use an index-only scan -- every
-- count read the whole heap. After one VACUUM (ANALYZE) the same count is
-- 66 ms.
--
-- The insert threshold is what these tables need: vacuum once enough rows have
-- been *added*, regardless of how few have died. A lower analyse scale factor
-- keeps the planner's statistics honest during an import rather than only once
-- the table has grown by a fifth.
--
-- Run VACUUM (ANALYZE) on these by hand after a county import if you want the
-- benefit immediately; autovacuum will otherwise get there on its own now.

ALTER TABLE public.houses SET (
  autovacuum_vacuum_insert_threshold = 5000,
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.road_segments SET (
  autovacuum_vacuum_insert_threshold = 20000,
  autovacuum_vacuum_insert_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05
);

ALTER TABLE public.zone_houses SET (
  autovacuum_vacuum_insert_threshold = 5000,
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.house_ownership SET (
  autovacuum_vacuum_insert_threshold = 5000,
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.house_kinds SET (
  autovacuum_vacuum_insert_threshold = 5000,
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.eddm_segments SET (
  autovacuum_vacuum_insert_threshold = 20000,
  autovacuum_vacuum_insert_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05
);

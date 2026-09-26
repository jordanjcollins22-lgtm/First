-- A quarter of the county's roads were never roads at all.
--
-- The OpenStreetMap import asked for sidewalks, trails and cycleways along
-- with the streets. A sidewalk is drawn as a piece every ten metres beside
-- every street and outnumbers the streets four to one, and the walk
-- already refused to use them. A path is usually a trail through the
-- woods, which is the one place a door-hanger round must never go, and the
-- walk was free to route down one. Between them: 162,899 rows, a quarter
-- of the table, stored and indexed and mostly wrong.
--
-- The loader now refuses them whatever it is handed, so they cannot come
-- back on a re-import, and the ones already in are dropped. On the live
-- database this, with a VACUUM FULL after it, took 596 MB down to 471 MB.

CREATE OR REPLACE FUNCTION public.roads_load_tile(org UUID, the_tile TEXT, rows JSONB, replace BOOLEAN DEFAULT false)
RETURNS INTEGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n INTEGER;
BEGIN
  IF replace THEN DELETE FROM road_segments WHERE organization_id = org AND tile = the_tile; END IF;
  INSERT INTO road_segments (organization_id, tile, osm_id, highway, name, seg, bbox)
  SELECT org, the_tile, (r->>0)::bigint, r->>1, nullif(r->>2, ''),
         lseg(point((r->>3)::float8, (r->>4)::float8), point((r->>5)::float8, (r->>6)::float8)),
         box(point(least((r->>3)::float8, (r->>5)::float8), least((r->>4)::float8, (r->>6)::float8)),
             point(greatest((r->>3)::float8, (r->>5)::float8), greatest((r->>4)::float8, (r->>6)::float8)))
  FROM jsonb_array_elements(rows) r
  WHERE r->>3 IS NOT NULL AND r->>6 IS NOT NULL
    -- Not a road a round is walked on, whoever sends it.
    AND coalesce(r->>1, '') NOT IN ('footway', 'path', 'cycleway', 'steps', 'bridleway', 'corridor');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.roads_load_tile(UUID, TEXT, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;

DELETE FROM public.road_segments WHERE highway IN ('footway', 'path', 'cycleway', 'steps', 'bridleway', 'corridor');

-- houses_normalized_idx is the same two columns as houses_normalized_unique,
-- which already serves every lookup it did. Thirteen megabytes of duplicate.
DROP INDEX IF EXISTS public.houses_normalized_idx;

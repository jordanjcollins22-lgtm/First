-- What is wrong with a drawn round, said out loud.
--
-- 0199 stopped the walk drawing a line where there was no road. That fixed the
-- lie; it did not tell anybody the route was bad. Across two hundred and
-- thirty-seven walked zones there turned out to be:
--
--   2,151 crossings of a trunk road on foot, over 101 zones
--   2,343 doors more than sixty metres from the line, over 163 zones
--     153 breaks in the round, over 61 zones
--      30 stretches of line with no road under them, over 8 zones
--
-- One round crosses Pulaski Highway thirty-four times. That is the only thing
-- on this map that can actually hurt somebody, and nothing was looking for it.
--
-- Four faults, each of which is a real thing a person would object to if they
-- saw it. Each carries a severity, and 'bad' is reserved for the two that
-- make a round unsafe or unrunnable rather than merely wasteful:
--
--   unsafe_crossing   -- the walk cuts across a trunk road on foot
--   disconnected      -- the round is in pieces with driving between them
--   no_road_under_it  -- a drawn stretch nothing maps: woods, a stream, a
--                        treeline, or a driveway. Nothing here can tell those
--                        apart, so it is reported rather than guessed at
--   doors_not_passed  -- doors the line never comes near, reached from a back
--                        road or not reached at all
--
-- The angle is what separates following a main road from cutting across one:
-- more than forty degrees is walking over it, not along it.
--
-- The faults are a read of what the walk drew. They change nothing about the
-- route and never will -- the router is left exactly as it is, and what to do
-- about a bad round is a person's decision.

ALTER TABLE public.hanger_zones ADD COLUMN IF NOT EXISTS walk_faults JSONB;
ALTER TABLE public.hanger_zones ADD COLUMN IF NOT EXISTS walk_quality TEXT
  CHECK (walk_quality IS NULL OR walk_quality IN ('good', 'check', 'bad', 'unknown'));

CREATE OR REPLACE FUNCTION public.zone_walk_faults(the_zone uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '55s'
AS $function$
DECLARE
  org UUID; wl JSONB; runs JSONB; breaks INTEGER; jump REAL;
  kx DOUBLE PRECISION := cos(radians(39.5)) * 111320.0; ky DOUBLE PRECISION := 110574.0;
  minx DOUBLE PRECISION; maxx DOUBLE PRECISION; miny DOUBLE PRECISION; maxy DOUBLE PRECISION;
  faults JSONB := '[]'::jsonb; quality TEXT := 'good';
  n_houses INTEGER := 0; n_far INTEGER := 0; n_bridge INTEGER := 0; longest DOUBLE PRECISION := 0;
  n_cross INTEGER := 0; cross_names TEXT;
BEGIN
  SELECT organization_id, walk_line, walk_breaks, walk_jump_m
    INTO org, wl, breaks, jump
  FROM hanger_zones WHERE id = the_zone;

  IF wl IS NULL OR jsonb_typeof(wl) <> 'array' OR jsonb_array_length(wl) = 0 THEN
    UPDATE hanger_zones SET walk_quality = 'unknown', walk_faults = '[]'::jsonb WHERE id = the_zone;
    RETURN jsonb_build_object('quality', 'unknown', 'faults', '[]'::jsonb);
  END IF;

  -- walk_line is one run of streets, or an array of runs when the round
  -- breaks. Told apart by whether the first element is a pair or a list.
  IF jsonb_typeof(wl->0->0) = 'array' THEN runs := wl; ELSE runs := jsonb_build_array(wl); END IF;

  DROP TABLE IF EXISTS zf_legs;
  CREATE TEMP TABLE zf_legs ON COMMIT DROP AS
  SELECT r.ord AS run,
         p.ord AS i,
         ST_Transform(ST_SetSRID(ST_MakePoint((p.pt->>0)::float8, (p.pt->>1)::float8), 4326), 26985) AS a,
         ST_Transform(ST_SetSRID(ST_MakePoint((lead(p.pt) OVER (PARTITION BY r.ord ORDER BY p.ord)->>0)::float8,
                                              (lead(p.pt) OVER (PARTITION BY r.ord ORDER BY p.ord)->>1)::float8), 4326), 26985) AS b
  FROM jsonb_array_elements(runs) WITH ORDINALITY AS r(run, ord),
       jsonb_array_elements(r.run) WITH ORDINALITY AS p(pt, ord);
  DELETE FROM zf_legs WHERE b IS NULL;

  DROP TABLE IF EXISTS zf_lines;
  CREATE TEMP TABLE zf_lines ON COMMIT DROP AS
  SELECT run, i, ST_MakeLine(a, b) AS g, ST_Distance(a, b) AS len FROM zf_legs;
  CREATE INDEX ON zf_lines USING gist (g);

  IF NOT EXISTS (SELECT 1 FROM zf_lines) THEN
    UPDATE hanger_zones SET walk_quality = 'unknown', walk_faults = '[]'::jsonb WHERE id = the_zone;
    RETURN jsonb_build_object('quality', 'unknown', 'faults', '[]'::jsonb);
  END IF;

  DROP TABLE IF EXISTS zf_pts;
  CREATE TEMP TABLE zf_pts ON COMMIT DROP AS
  SELECT h.id, h.address, h.lng, h.lat,
         ST_Transform(house_geom(h.lng, h.lat), 26985) AS g
  FROM zone_houses zh JOIN houses h ON h.id = zh.house_id
  WHERE zh.zone_id = the_zone AND h.lng IS NOT NULL AND h.lat IS NOT NULL;
  SELECT count(*) INTO n_houses FROM zf_pts;

  SELECT min(lng) * kx - 300, max(lng) * kx + 300, min(lat) * ky - 300, max(lat) * ky + 300
    INTO minx, maxx, miny, maxy FROM zf_pts;

  DROP TABLE IF EXISTS zf_roads;
  CREATE TEMP TABLE zf_roads ON COMMIT DROP AS
  SELECT s.highway, s.name,
         ST_Transform(ST_SetSRID(ST_MakeLine(
           ST_MakePoint((s.seg[0])[0] / kx, (s.seg[0])[1] / ky),
           ST_MakePoint((s.seg[1])[0] / kx, (s.seg[1])[1] / ky)), 4326), 26985) AS g
  FROM road_segments s
  WHERE s.organization_id = org
    AND minx IS NOT NULL
    AND s.bbox && box(point(minx, miny), point(maxx, maxy))
    AND s.highway IS DISTINCT FROM 'footway';
  CREATE INDEX ON zf_roads USING gist (g);

  -- 1. The round is in pieces.
  IF coalesce(breaks, 0) > 0 THEN
    faults := faults || jsonb_build_object(
      'kind', 'disconnected',
      'severity', CASE WHEN breaks >= 3 OR coalesce(jump, 0) > 800 THEN 'bad' ELSE 'check' END,
      'count', breaks,
      'says', format('The round is in %s pieces, %s m of driving between them.', breaks + 1, round(coalesce(jump, 0)::numeric)));
  END IF;

  -- 2. Lines with no road under them.
  --
  -- The router bridges islands up to a hundred and fifty metres apart on the
  -- assumption that the gap is an unmapped driveway or cut-through. Usually it
  -- is. Sometimes it is a stream, a treeline or the back of two gardens, and
  -- there is no data here that can tell the difference -- so the ones long
  -- enough to be worth a human eye are reported rather than guessed at.
  SELECT count(*), coalesce(max(len), 0) INTO n_bridge, longest
  FROM zf_lines l
  WHERE l.len > 80
    AND NOT EXISTS (
      SELECT 1 FROM zf_roads r
      WHERE ST_DWithin(r.g, ST_LineInterpolatePoint(l.g, 0.5), 15)
    );
  IF n_bridge > 0 THEN
    faults := faults || jsonb_build_object(
      'kind', 'no_road_under_it',
      'severity', CASE WHEN longest > 150 THEN 'bad' ELSE 'check' END,
      'count', n_bridge,
      'says', format('%s stretch%s of the line has no road under it, the longest %s m. Check it is not through woods or over a stream.',
                     n_bridge, CASE WHEN n_bridge = 1 THEN '' ELSE 'es' END, round(longest::numeric)));
  END IF;

  -- 3. Crossing something nobody should cross on foot.
  --
  -- Following a main road is normal. Cutting across one is not, and the
  -- difference is the angle: more than forty degrees is walking over it.
  SELECT count(*), string_agg(DISTINCT nm, ', ') INTO n_cross, cross_names
  FROM (
    SELECT DISTINCT l.run, l.i, coalesce(r.name, 'a main road') AS nm
    FROM zf_lines l
    JOIN zf_roads r ON r.g && ST_Expand(l.g, 1) AND ST_Intersects(l.g, r.g)
    CROSS JOIN LATERAL (
      SELECT mod(abs(degrees(ST_Azimuth(ST_StartPoint(l.g), ST_EndPoint(l.g))
                           - ST_Azimuth(ST_StartPoint(r.g), ST_EndPoint(r.g))))::numeric, 180::numeric) AS raw
    ) ang
    WHERE r.highway IN ('motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link')
      AND l.len > 1
      AND ST_Length(r.g) > 1
      AND least(ang.raw, 180 - ang.raw) > 40
  ) x;
  IF coalesce(n_cross, 0) > 0 THEN
    faults := faults || jsonb_build_object(
      'kind', 'unsafe_crossing',
      'severity', 'bad',
      'count', n_cross,
      'says', format('The round crosses %s on foot %s time%s.', cross_names, n_cross, CASE WHEN n_cross = 1 THEN '' ELSE 's' END));
  END IF;

  -- 4. Doors the walk never passes.
  --
  -- A house more than sixty metres from the drawn line is not on this round in
  -- any useful sense: it is round the back, on a different street, or up a
  -- drive nobody walks. Counting them is the only way to know the route
  -- actually covers what the zone claims.
  SELECT count(*) INTO n_far
  FROM zf_pts p
  WHERE NOT EXISTS (SELECT 1 FROM zf_lines l WHERE ST_DWithin(l.g, p.g, 60));
  IF n_far > 0 AND n_houses > 0 THEN
    faults := faults || jsonb_build_object(
      'kind', 'doors_not_passed',
      'severity', CASE WHEN n_far::float8 / n_houses > 0.25 THEN 'bad' ELSE 'check' END,
      'count', n_far,
      'says', format('%s of %s doors are more than 60 m from the line — reached from a back road, or not reached at all.', n_far, n_houses));
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(faults) f WHERE f->>'severity' = 'bad') THEN
    quality := 'bad';
  ELSIF jsonb_array_length(faults) > 0 THEN
    quality := 'check';
  END IF;

  UPDATE hanger_zones SET walk_faults = faults, walk_quality = quality WHERE id = the_zone;
  RETURN jsonb_build_object('quality', quality, 'faults', faults);
END $function$;

NOTIFY pgrst, 'reload schema';

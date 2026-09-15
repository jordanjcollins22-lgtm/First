-- The walk itself: where to park, the order of the doors, and whether it is
-- a walk at all.
--
-- Parking is the point on the route's own streets nearest the middle of the
-- zone's houses: park once, work outward and back. The order is greedy --
-- from the parking spot, always the nearest door not yet done -- which is
-- how a hanger team actually moves, zigzagging a street. The path length
-- per door says what the zone is: under thirty-five metres a door is a
-- walk, under seventy-five a scooter, beyond that a vehicle -- the median
-- gap alone reads a rural route as a walk because its houses come in
-- dense pockets with long hops between. Time is the path at that mode's
-- pace plus a stop at every door.
--
-- Also: adoption now takes houses with no readable ZIP, so none is left out.

CREATE OR REPLACE FUNCTION public.zone_adopt_leftovers(org UUID, the_zip TEXT)
RETURNS INTEGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n INTEGER;
BEGIN
  WITH orphans AS (
    SELECT h.id, house_geom(h.lng, h.lat) AS g FROM houses h
    WHERE h.organization_id = org AND h.kind = 'house' AND NOT h.needs_review AND NOT (h.lat = 0 AND h.lng = 0)
      AND (the_zip IS NULL OR right(h.normalized_address, 5) = the_zip) AND h.eddm_route_id IS NULL
  ),
  adopted AS (
    SELECT o.id, (SELECT h2.eddm_route_id FROM houses h2
                  WHERE h2.organization_id = org AND h2.eddm_route_id IS NOT NULL AND h2.kind = 'house' AND NOT h2.needs_review
                  ORDER BY house_geom(h2.lng, h2.lat) <-> o.g LIMIT 1) AS route_id
    FROM orphans o
  )
  UPDATE houses h SET eddm_route_id = a.route_id, eddm_unserved = true
  FROM adopted a WHERE a.id = h.id AND a.route_id IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.zone_walk(the_zone UUID)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  n INTEGER; centre geometry; park geometry; cur geometry; nxt RECORD;
  total_m DOUBLE PRECISION := 0; gaps DOUBLE PRECISION[] := '{}'; med DOUBLE PRECISION; the_mode TEXT;
  path JSONB := '[]'::jsonb; first_id UUID; first_addr TEXT; last_pt geometry; minutes INTEGER; park_ll geometry;
  pace_kmh DOUBLE PRECISION; stop_s DOUBLE PRECISION; i INTEGER := 0;
BEGIN
  -- The doors, in metres (Maryland State Plane), with a spatial index for
  -- the nearest-unvisited lookups.
  CREATE TEMP TABLE IF NOT EXISTS zw_pts (id UUID, address TEXT, g geometry, ll geometry, done BOOLEAN) ON COMMIT DROP;
  TRUNCATE zw_pts;
  INSERT INTO zw_pts
  SELECT h.id, h.address, ST_Transform(house_geom(h.lng, h.lat), 26985), house_geom(h.lng, h.lat), false
  FROM zone_houses zh JOIN houses h ON h.id = zh.house_id WHERE zh.zone_id = the_zone;
  CREATE INDEX IF NOT EXISTS zw_pts_idx ON zw_pts USING gist (g);
  SELECT count(*) INTO n FROM zw_pts;
  IF n = 0 THEN
    UPDATE hanger_zones SET walk_path = NULL, park_point = NULL, start_point = NULL, end_point = NULL, mode = NULL,
      path_km = NULL, est_minutes = NULL, median_gap_m = NULL, house_count = 0, updated_at = now() WHERE id = the_zone;
    RETURN jsonb_build_object('houses', 0);
  END IF;

  -- Parking: the route's street vertex nearest the middle of the doors; a
  -- door itself when the zone has no streets of its own.
  SELECT ST_Centroid(ST_Collect(g)) INTO centre FROM zw_pts;
  SELECT ST_Transform(ST_SetSRID(ST_MakePoint((s.seg[0])[0] / (cos(radians(39.5)) * 111320.0), (s.seg[0])[1] / 110574.0), 4326), 26985)
    INTO park
  FROM hanger_zones z JOIN eddm_segments s ON s.route_id = z.eddm_route_id
  WHERE z.id = the_zone
  ORDER BY ST_Transform(ST_SetSRID(ST_MakePoint((s.seg[0])[0] / (cos(radians(39.5)) * 111320.0), (s.seg[0])[1] / 110574.0), 4326), 26985) <-> centre
  LIMIT 1;
  IF park IS NULL THEN
    SELECT g INTO park FROM zw_pts ORDER BY g <-> centre LIMIT 1;
  END IF;
  park_ll := ST_Transform(park, 4326);

  -- Greedy: always the nearest door left.
  cur := park;
  LOOP
    SELECT id, address, g, ll INTO nxt FROM zw_pts WHERE NOT done ORDER BY g <-> cur LIMIT 1;
    EXIT WHEN NOT FOUND;
    i := i + 1;
    IF i = 1 THEN
      first_id := nxt.id; first_addr := nxt.address;
    ELSE
      gaps := gaps || ST_Distance(cur, nxt.g);
    END IF;
    total_m := total_m + ST_Distance(cur, nxt.g);
    path := path || jsonb_build_object('lat', round(ST_Y(nxt.ll)::numeric, 6), 'lng', round(ST_X(nxt.ll)::numeric, 6));
    UPDATE zw_pts SET done = true WHERE id = nxt.id;
    cur := nxt.g; last_pt := nxt.ll;
  END LOOP;
  -- And back to the car.
  total_m := total_m + ST_Distance(cur, park);

  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY v) INTO med FROM unnest(gaps) v;
  med := coalesce(med, 0);
  the_mode := CASE WHEN total_m / n <= 35 THEN 'foot' WHEN total_m / n <= 75 THEN 'scooter' ELSE 'vehicle' END;
  pace_kmh := CASE the_mode WHEN 'foot' THEN 4.0 WHEN 'scooter' THEN 12.0 ELSE 25.0 END;
  stop_s := CASE the_mode WHEN 'foot' THEN 25 WHEN 'scooter' THEN 30 ELSE 45 END;
  minutes := round((total_m / 1000.0) / pace_kmh * 60 + n * stop_s / 60.0);

  UPDATE hanger_zones SET
    walk_path = path,
    park_point = jsonb_build_object('lat', round(ST_Y(park_ll)::numeric, 6), 'lng', round(ST_X(park_ll)::numeric, 6)),
    start_point = path->0,
    end_point = path->(jsonb_array_length(path) - 1),
    start_address = first_addr,
    house_count = n,
    path_km = round((total_m / 1000.0)::numeric, 2),
    est_minutes = minutes,
    median_gap_m = round(med::numeric, 1),
    mode = the_mode,
    updated_at = now()
  WHERE id = the_zone;

  RETURN jsonb_build_object('houses', n, 'pathKm', round((total_m / 1000.0)::numeric, 2), 'medianGapM', round(med::numeric, 1), 'mode', the_mode, 'minutes', minutes);
END $$;

-- One zone, all the way: outline and walk.
CREATE OR REPLACE FUNCTION public.zone_build(the_zone UUID)
RETURNS JSONB LANGUAGE sql SET search_path = public AS $$
  SELECT zone_outline(the_zone) || zone_walk(the_zone);
$$;

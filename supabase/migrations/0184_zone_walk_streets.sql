-- The walk follows the streets.
--
-- The walk used to go door to door in straight lines, which on a map is
-- through back yards and woods. Now the USPS street lines round the zone
-- are made into a network (pgRouting), every door is snapped to the
-- nearest curb, the distance between any two doors is measured along the
-- streets, the order is chosen on those distances -- always the nearest
-- door not yet done, along the street -- and the path drawn is the
-- streets walked, curb to curb, with the way up to each door counted
-- in the length. The mode and the time come off the street length,
-- which is the honest one. A zone with no street lines near it falls
-- back to the straight-line walk.
--
-- USPS draws only the streets it delivers on, so a main road with no
-- doors is missing and the subdivisions either side of it are islands.
-- Street ends within a few metres of each other are joined, and any
-- island is joined to the nearest street across the gap, up to sixty
-- metres, at a cost and a half for the crossing.
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgrouting WITH SCHEMA public;

ALTER TABLE public.hanger_zones ADD COLUMN IF NOT EXISTS walk_line JSONB;

-- The old walk, kept for a zone the streets do not reach.
CREATE OR REPLACE FUNCTION public.zone_walk_straight(the_zone UUID)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  n INTEGER; centre geometry; park geometry; cur geometry; nxt RECORD;
  total_m DOUBLE PRECISION := 0; gaps DOUBLE PRECISION[] := '{}'; med DOUBLE PRECISION; the_mode TEXT;
  path JSONB := '[]'::jsonb; first_addr TEXT; minutes INTEGER; park_ll geometry;
  pace_kmh DOUBLE PRECISION; stop_s DOUBLE PRECISION; i INTEGER := 0;
BEGIN
  DROP TABLE IF EXISTS zws_pts;
  CREATE TEMP TABLE zws_pts (id UUID, address TEXT, g geometry, ll geometry, done BOOLEAN) ON COMMIT DROP;
  INSERT INTO zws_pts
  SELECT h.id, h.address, ST_Transform(house_geom(h.lng, h.lat), 26985), house_geom(h.lng, h.lat), false
  FROM zone_houses zh JOIN houses h ON h.id = zh.house_id WHERE zh.zone_id = the_zone;
  CREATE INDEX ON zws_pts USING gist (g);
  SELECT count(*) INTO n FROM zws_pts;
  IF n = 0 THEN
    UPDATE hanger_zones SET walk_path = NULL, walk_line = NULL, park_point = NULL, start_point = NULL, end_point = NULL, mode = NULL,
      path_km = NULL, est_minutes = NULL, median_gap_m = NULL, house_count = 0, updated_at = now() WHERE id = the_zone;
    RETURN jsonb_build_object('houses', 0);
  END IF;
  SELECT ST_Centroid(ST_Collect(g)) INTO centre FROM zws_pts;
  SELECT g INTO park FROM zws_pts ORDER BY g <-> centre LIMIT 1;
  park_ll := ST_Transform(park, 4326);
  cur := park;
  LOOP
    SELECT id, address, g, ll INTO nxt FROM zws_pts WHERE NOT done ORDER BY g <-> cur LIMIT 1;
    EXIT WHEN NOT FOUND;
    i := i + 1;
    IF i = 1 THEN first_addr := nxt.address; ELSE gaps := gaps || ST_Distance(cur, nxt.g); END IF;
    total_m := total_m + ST_Distance(cur, nxt.g);
    path := path || jsonb_build_object('lat', round(ST_Y(nxt.ll)::numeric, 6), 'lng', round(ST_X(nxt.ll)::numeric, 6));
    UPDATE zws_pts SET done = true WHERE id = nxt.id;
    cur := nxt.g;
  END LOOP;
  total_m := total_m + ST_Distance(cur, park);
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY v) INTO med FROM unnest(gaps) v;
  med := coalesce(med, 0);
  the_mode := CASE WHEN total_m / n <= 35 THEN 'foot' WHEN total_m / n <= 75 THEN 'scooter' ELSE 'vehicle' END;
  pace_kmh := CASE the_mode WHEN 'foot' THEN 4.0 WHEN 'scooter' THEN 12.0 ELSE 25.0 END;
  stop_s := CASE the_mode WHEN 'foot' THEN 25 WHEN 'scooter' THEN 30 ELSE 45 END;
  minutes := round((total_m / 1000.0) / pace_kmh * 60 + n * stop_s / 60.0);
  UPDATE hanger_zones SET walk_path = path, walk_line = NULL,
    park_point = jsonb_build_object('lat', round(ST_Y(park_ll)::numeric, 6), 'lng', round(ST_X(park_ll)::numeric, 6)),
    start_point = path->0, end_point = path->(jsonb_array_length(path) - 1), start_address = first_addr,
    house_count = n, path_km = round((total_m / 1000.0)::numeric, 2), est_minutes = minutes,
    median_gap_m = round(med::numeric, 1), mode = the_mode, updated_at = now()
  WHERE id = the_zone;
  RETURN jsonb_build_object('houses', n, 'pathKm', round((total_m / 1000.0)::numeric, 2), 'medianGapM', round(med::numeric, 1), 'mode', the_mode, 'minutes', minutes, 'streets', false);
END $$;

CREATE OR REPLACE FUNCTION public.zone_walk(the_zone UUID)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp SET statement_timeout = '55s' AS $$
DECLARE
  org UUID; n INTEGER; n_streets INTEGER; centre geometry; park geometry; park_ll geometry; park_edge BIGINT; park_frac DOUBLE PRECISION;
  kx DOUBLE PRECISION := cos(radians(39.5)) * 111320.0; ky DOUBLE PRECISION := 110574.0;
  minx DOUBLE PRECISION; maxx DOUBLE PRECISION; miny DOUBLE PRECISION; maxy DOUBLE PRECISION;
  cur INTEGER; cur_g geometry; nxt RECORD; i INTEGER := 0; total_m DOUBLE PRECISION := 0; gaps DOUBLE PRECISION[] := '{}';
  med DOUBLE PRECISION; the_mode TEXT; pace_kmh DOUBLE PRECISION; stop_s DOUBLE PRECISION; minutes INTEGER;
  path JSONB := '[]'::jsonb; first_addr TEXT; line geometry; line_json JSONB; strays INTEGER := 0; pass INTEGER;
BEGIN
  SELECT organization_id INTO org FROM hanger_zones WHERE id = the_zone;

  DROP TABLE IF EXISTS zw_pts;
  CREATE TEMP TABLE zw_pts (pid INTEGER, id UUID, address TEXT, g geometry, ll geometry, done BOOLEAN DEFAULT false) ON COMMIT DROP;
  INSERT INTO zw_pts (pid, id, address, g, ll)
  SELECT row_number() OVER (ORDER BY h.id), h.id, h.address, ST_Transform(house_geom(h.lng, h.lat), 26985), house_geom(h.lng, h.lat)
  FROM zone_houses zh JOIN houses h ON h.id = zh.house_id WHERE zh.zone_id = the_zone;
  CREATE INDEX ON zw_pts USING gist (g);
  CREATE INDEX ON zw_pts (pid);
  SELECT count(*) INTO n FROM zw_pts;
  IF n = 0 THEN RETURN zone_walk_straight(the_zone); END IF;

  -- The streets round the doors: every route's, three hundred metres out.
  SELECT min(ST_X(ll)) * kx - 300, max(ST_X(ll)) * kx + 300, min(ST_Y(ll)) * ky - 300, max(ST_Y(ll)) * ky + 300
    INTO minx, maxx, miny, maxy FROM zw_pts;
  DROP TABLE IF EXISTS zw_raw;
  CREATE TEMP TABLE zw_raw ON COMMIT DROP AS
  SELECT ST_Transform(ST_SetSRID(ST_MakeLine(
           ST_MakePoint((s.seg[0])[0] / kx, (s.seg[0])[1] / ky),
           ST_MakePoint((s.seg[1])[0] / kx, (s.seg[1])[1] / ky)), 4326), 26985) AS g
  FROM eddm_segments s
  WHERE s.organization_id = org AND s.bbox && box(point(minx, miny), point(maxx, maxy));
  SELECT count(*) INTO n_streets FROM zw_raw;
  IF n_streets = 0 THEN RETURN zone_walk_straight(the_zone); END IF;

  -- One network: split where streets cross, ends matched to a centimetre.
  DROP TABLE IF EXISTS zw_edges;
  CREATE TEMP TABLE zw_edges (id BIGSERIAL, geom geometry, source BIGINT, target BIGINT, cost DOUBLE PRECISION, reverse_cost DOUBLE PRECISION) ON COMMIT DROP;
  INSERT INTO zw_edges (geom)
  SELECT (d).geom FROM (SELECT ST_Dump(ST_Node(ST_Snap(c, c, 4.0))) AS d FROM (SELECT ST_Collect(g) AS c FROM zw_raw) cc) x WHERE ST_Length((d).geom) > 0.05;
  DROP TABLE IF EXISTS zw_nodes;
  CREATE TEMP TABLE zw_nodes ON COMMIT DROP AS
  SELECT dense_rank() OVER (ORDER BY key) AS vid, key, geom FROM (
    SELECT DISTINCT ON (key) key, geom FROM (
      SELECT ST_AsText(ST_SnapToGrid(ST_StartPoint(geom), 0.01)) AS key, ST_StartPoint(geom) AS geom FROM zw_edges
      UNION ALL SELECT ST_AsText(ST_SnapToGrid(ST_EndPoint(geom), 0.01)), ST_EndPoint(geom) FROM zw_edges) k) kk;
  CREATE INDEX ON zw_nodes (key);
  CREATE INDEX ON zw_nodes USING gist (geom);
  UPDATE zw_edges e SET source = s.vid, target = t.vid, cost = ST_Length(e.geom), reverse_cost = ST_Length(e.geom)
  FROM zw_nodes s, zw_nodes t
  WHERE s.key = ST_AsText(ST_SnapToGrid(ST_StartPoint(e.geom), 0.01)) AND t.key = ST_AsText(ST_SnapToGrid(ST_EndPoint(e.geom), 0.01));
  CREATE INDEX ON zw_edges USING gist (geom);
  CREATE INDEX ON zw_edges (id);

  -- Islands joined across the road USPS did not draw: each island to the
  -- nearest street of another, up to sixty metres, a few times over.
  FOR pass IN 1..4 LOOP
    DROP TABLE IF EXISTS zw_comp;
    CREATE TEMP TABLE zw_comp ON COMMIT DROP AS
    SELECT node, component FROM pgr_connectedComponents('SELECT id, source, target, cost FROM zw_edges');
    CREATE INDEX ON zw_comp (node);
    EXIT WHEN (SELECT count(DISTINCT component) FROM zw_comp) <= 1;
    INSERT INTO zw_edges (geom, source, target, cost, reverse_cost)
    SELECT ST_MakeLine(ag, bg), av, bv, ST_Distance(ag, bg) * 1.5, ST_Distance(ag, bg) * 1.5
    FROM (
      SELECT DISTINCT ON (ca.component) ca.component, a.vid AS av, a.geom AS ag, b.vid AS bv, b.geom AS bg
      FROM zw_nodes a JOIN zw_comp ca ON ca.node = a.vid
      JOIN LATERAL (
        SELECT b.vid, b.geom FROM zw_nodes b JOIN zw_comp cb ON cb.node = b.vid
        WHERE cb.component <> ca.component AND ST_DWithin(a.geom, b.geom, 60)
        ORDER BY a.geom <-> b.geom LIMIT 1) b ON true
      ORDER BY ca.component, ST_Distance(a.geom, b.geom)) bridges;
    EXIT WHEN NOT FOUND;
  END LOOP;

  -- Every door at its curb: the nearest point on the nearest street, and
  -- how far up the drive the door is from there.
  DROP TABLE IF EXISTS zw_curb;
  CREATE TEMP TABLE zw_curb (pid INTEGER, edge_id BIGINT, fraction DOUBLE PRECISION, side CHAR(1) DEFAULT 'b', g geometry, off_m DOUBLE PRECISION) ON COMMIT DROP;
  INSERT INTO zw_curb (pid, edge_id, fraction, side, g, off_m)
  -- A point exactly on a street corner cannot be routed from, so a door
  -- at a corner is placed a hair along the street.
  SELECT p.pid, e.id, least(greatest(ST_LineLocatePoint(e.geom, p.g), 0.001), 0.999), 'b', ST_ClosestPoint(e.geom, p.g), ST_Distance(e.geom, p.g)
  FROM zw_pts p CROSS JOIN LATERAL (SELECT id, geom FROM zw_edges ORDER BY geom <-> p.g LIMIT 1) e;

  -- Park at the street corner nearest the middle of the doors.
  SELECT ST_Centroid(ST_Collect(g)) INTO centre FROM zw_pts;
  SELECT e.id, CASE WHEN ST_Distance(ST_StartPoint(e.geom), centre) <= ST_Distance(ST_EndPoint(e.geom), centre) THEN 0.001 ELSE 0.999 END
    INTO park_edge, park_frac FROM zw_edges e ORDER BY e.geom <-> centre LIMIT 1;
  INSERT INTO zw_curb (pid, edge_id, fraction, side, g, off_m)
  SELECT n + 1, park_edge, park_frac, 'b', ST_LineInterpolatePoint(geom, park_frac), 0 FROM zw_edges WHERE id = park_edge;
  SELECT g INTO park FROM zw_curb WHERE pid = n + 1;
  park_ll := ST_Transform(park, 4326);
  CREATE INDEX ON zw_curb (pid);

  -- The distance from every door to its sixty nearest, along the streets.
  -- Every door to every other is the square of the doors and takes a
  -- minute for the biggest zones; the walk only ever goes to a near one.
  CREATE INDEX ON zw_curb USING gist (g);
  DROP TABLE IF EXISTS zw_pairs;
  CREATE TEMP TABLE zw_pairs ON COMMIT DROP AS
  SELECT a.pid AS source_pid, b.pid AS target_pid
  FROM zw_curb a CROSS JOIN LATERAL (SELECT pid FROM zw_curb b WHERE b.pid <> a.pid ORDER BY b.g <-> a.g LIMIT 60) b;
  DROP TABLE IF EXISTS zw_cost;
  CREATE TEMP TABLE zw_cost ON COMMIT DROP AS
  SELECT start_pid AS start_vid, end_pid AS end_vid, agg_cost FROM pgr_withPointsCost(
    'SELECT id, source, target, cost, reverse_cost FROM zw_edges',
    'SELECT pid, edge_id, fraction, side FROM zw_curb',
    'SELECT -source_pid AS source, -target_pid AS target FROM zw_pairs',
    directed := false);
  -- Two doors on the same stretch of street are not routed by the
  -- network; the distance is simply along that stretch.
  INSERT INTO zw_cost (start_vid, end_vid, agg_cost)
  SELECT -a.pid, -b.pid, abs(a.fraction - b.fraction) * ST_Length(e.geom)
  FROM zw_curb a JOIN zw_curb b ON b.edge_id = a.edge_id AND b.pid <> a.pid JOIN zw_edges e ON e.id = a.edge_id;
  CREATE INDEX ON zw_cost (start_vid, agg_cost);

  -- Always the nearest door not yet done, along the street. When none of
  -- the near ones is left, the nearest as the crow flies, and the street
  -- to it is measured with the path.
  DROP TABLE IF EXISTS zw_legs;
  CREATE TEMP TABLE zw_legs (seq INTEGER, source BIGINT, target BIGINT, guess_m DOUBLE PRECISION, straight BOOLEAN DEFAULT false, same_edge BOOLEAN DEFAULT false) ON COMMIT DROP;
  cur := n + 1; cur_g := park;
  LOOP
    SELECT p.pid, p.address, p.ll, p.g, c.agg_cost AS cost INTO nxt
    FROM zw_cost c JOIN zw_pts p ON p.pid = -c.end_vid
    WHERE c.start_vid = -cur AND NOT p.done
    ORDER BY c.agg_cost LIMIT 1;
    IF NOT FOUND THEN
      SELECT p.pid, p.address, p.ll, p.g, ST_Distance(p.g, cur_g) * 1.3 AS cost INTO nxt
      FROM zw_pts p WHERE NOT p.done ORDER BY p.g <-> cur_g LIMIT 1;
      EXIT WHEN NOT FOUND;
    END IF;
    i := i + 1;
    IF i = 1 THEN first_addr := nxt.address; END IF;
    INSERT INTO zw_legs (seq, source, target, guess_m) VALUES (i, -cur, -nxt.pid, nxt.cost);
    path := path || jsonb_build_object('lat', round(ST_Y(nxt.ll)::numeric, 6), 'lng', round(ST_X(nxt.ll)::numeric, 6));
    UPDATE zw_pts SET done = true WHERE pid = nxt.pid;
    cur := nxt.pid; cur_g := nxt.g;
  END LOOP;
  INSERT INTO zw_legs (seq, source, target, guess_m) VALUES (i + 1, -cur, -(n + 1), ST_Distance(cur_g, park) * 1.3);
  UPDATE zw_legs l SET same_edge = (a.edge_id = b.edge_id) FROM zw_curb a, zw_curb b WHERE a.pid = -l.source AND b.pid = -l.target;

  -- The streets walked, leg by leg: the true length of each, and the line.
  DROP TABLE IF EXISTS zw_steps;
  CREATE TEMP TABLE zw_steps ON COMMIT DROP AS
  SELECT l.seq AS leg, s.path_seq, s.node, s.edge, s.agg_cost,
         lead(s.node) OVER (PARTITION BY s.start_pid, s.end_pid ORDER BY s.path_seq) AS next_node
  FROM pgr_withPoints(
    'SELECT id, source, target, cost, reverse_cost FROM zw_edges',
    'SELECT pid, edge_id, fraction, side FROM zw_curb',
    'SELECT source, target FROM zw_legs WHERE NOT same_edge',
    directed := false, driving_side := 'b', details := false) s
  JOIN zw_legs l ON l.source = s.start_pid AND l.target = s.end_pid;
  CREATE INDEX ON zw_steps (leg);
  -- A leg the streets do not join is taken as the crow flies.
  UPDATE zw_legs l SET straight = NOT l.same_edge AND NOT EXISTS (SELECT 1 FROM zw_steps st WHERE st.leg = l.seq);
  SELECT count(*) INTO strays FROM zw_legs WHERE straight;

  -- Each leg's length: the street, plus the way up to the door (a long
  -- drive is not walked to its end: thirty metres of it at most).
  DROP TABLE IF EXISTS zw_leg_m;
  CREATE TEMP TABLE zw_leg_m ON COMMIT DROP AS
  SELECT l.seq,
         CASE WHEN l.same_edge THEN (SELECT abs(a.fraction - b.fraction) * ST_Length(e.geom) FROM zw_curb a, zw_curb b, zw_edges e WHERE a.pid = -l.source AND b.pid = -l.target AND e.id = a.edge_id)
              WHEN l.straight THEN l.guess_m
              ELSE (SELECT max(st.agg_cost) FROM zw_steps st WHERE st.leg = l.seq) END
         + CASE WHEN -l.target = n + 1 THEN 0 ELSE least((SELECT off_m FROM zw_curb WHERE pid = -l.target), 30) END AS m
  FROM zw_legs l;
  SELECT coalesce(sum(m), 0) INTO total_m FROM zw_leg_m;
  SELECT coalesce(array_agg(m ORDER BY seq), '{}') INTO gaps FROM zw_leg_m WHERE seq > 1 AND seq <= i;

  -- Every street piece is a straight segment (USPS draws them so, and
  -- noding only cuts them), so the way from one stop to the next along a
  -- piece is the line between where the two are: a corner, or a door's
  -- curb. That is the whole geometry, with no edge bookkeeping to get
  -- wrong.
  CREATE INDEX ON zw_nodes (vid);
  WITH pieces AS (
    SELECT st.leg, st.path_seq, ST_MakeLine(pu.g, pv.g) AS piece
    FROM zw_steps st
    JOIN LATERAL (SELECT c.g FROM zw_curb c WHERE c.pid = -st.node UNION ALL SELECT nd.geom FROM zw_nodes nd WHERE nd.vid = st.node LIMIT 1) pu ON true
    JOIN LATERAL (SELECT c.g FROM zw_curb c WHERE c.pid = -st.next_node UNION ALL SELECT nd.geom FROM zw_nodes nd WHERE nd.vid = st.next_node LIMIT 1) pv ON true
    WHERE st.next_node IS NOT NULL
  ),
  same_edge AS (
    SELECT l.seq AS leg, 0 AS path_seq, ST_MakeLine(a.g, b.g) AS piece
    FROM zw_legs l JOIN zw_curb a ON a.pid = -l.source JOIN zw_curb b ON b.pid = -l.target
    WHERE l.same_edge
  ),
  straight AS (
    SELECT l.seq AS leg, 0 AS path_seq, ST_MakeLine(a.g, b.g) AS piece
    FROM zw_legs l JOIN zw_curb a ON a.pid = -l.source JOIN zw_curb b ON b.pid = -l.target
    WHERE l.straight
  )
  -- Joined strictly in walking order. A merge by shared ends would put
  -- the pieces back in its own order wherever the walk passes a corner
  -- twice, and the line would leap across the zone between them.
  SELECT ST_MakeLine(array_agg(piece ORDER BY leg, path_seq)) INTO line
  FROM (SELECT * FROM pieces UNION ALL SELECT * FROM same_edge UNION ALL SELECT * FROM straight) all_pieces
  WHERE piece IS NOT NULL AND NOT ST_IsEmpty(piece);

  IF line IS NOT NULL THEN
    line := ST_Simplify(line, 0.4);
    SELECT jsonb_agg(jsonb_build_array(round(ST_X(pt.geom)::numeric, 6), round(ST_Y(pt.geom)::numeric, 6)) ORDER BY pt.path)
      INTO line_json
    FROM ST_DumpPoints(ST_Transform(line, 4326)) pt;
  END IF;

  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY v) INTO med FROM unnest(gaps) v;
  med := coalesce(med, 0);
  -- Along the streets a suburban door is thirty-odd metres from the next
  -- once the way up to it is counted; the thresholds are for that.
  the_mode := CASE WHEN total_m / n <= 55 THEN 'foot' WHEN total_m / n <= 110 THEN 'scooter' ELSE 'vehicle' END;
  pace_kmh := CASE the_mode WHEN 'foot' THEN 4.0 WHEN 'scooter' THEN 12.0 ELSE 25.0 END;
  stop_s := CASE the_mode WHEN 'foot' THEN 25 WHEN 'scooter' THEN 30 ELSE 45 END;
  minutes := round((total_m / 1000.0) / pace_kmh * 60 + n * stop_s / 60.0);

  UPDATE hanger_zones SET
    walk_path = path,
    walk_line = line_json,
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

  RETURN jsonb_build_object('houses', n, 'pathKm', round((total_m / 1000.0)::numeric, 2), 'medianGapM', round(med::numeric, 1),
    'mode', the_mode, 'minutes', minutes, 'streets', true, 'strays', strays, 'edges', (SELECT count(*) FROM zw_edges));
END $$;

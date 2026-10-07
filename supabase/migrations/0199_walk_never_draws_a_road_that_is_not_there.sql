-- The walk stops drawing a line where there is no road.
--
-- When the streets round a zone leave two islands the router cannot join,
-- zone_walk fell back to the straight line between them and drew it. On
-- the map that is a stroke through a nature reserve, a golf course or the
-- back of a subdivision -- a route nobody can take, and the third time it
-- has been reported. Across the county a fifth of every drawn kilometre
-- was one of these.
--
-- Two changes. Islands a hundred and fifty metres apart are now joined,
-- not sixty: that distance is an unmapped driveway or a cut-through, and
-- it takes in the parking aisles and service roads that OpenStreetMap
-- leaves hanging off the street. And what is still not joined is no
-- longer drawn: the line is cut there and picks up on the far side, so
-- the map shows two strokes with a gap, which is the truth -- the round
-- is driven between them. How many gaps, and how far, is kept on the
-- zone, and the time allows for driving them rather than walking.
--
-- walk_line is now the run of streets when there is one (as before), or
-- an array of runs when the round breaks. Anything reading it tells the
-- two apart by whether the first element is a pair or a list.

ALTER TABLE public.hanger_zones ADD COLUMN IF NOT EXISTS walk_breaks INTEGER;
ALTER TABLE public.hanger_zones ADD COLUMN IF NOT EXISTS walk_jump_m REAL;

CREATE OR REPLACE FUNCTION public.zone_walk(the_zone uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '55s'
AS $function$
DECLARE
  org UUID; n INTEGER; n_streets INTEGER; centre geometry; park geometry; park_ll geometry; park_edge BIGINT; park_frac DOUBLE PRECISION;
  kx DOUBLE PRECISION := cos(radians(39.5)) * 111320.0; ky DOUBLE PRECISION := 110574.0;
  minx DOUBLE PRECISION; maxx DOUBLE PRECISION; miny DOUBLE PRECISION; maxy DOUBLE PRECISION;
  cur INTEGER; cur_g geometry; nxt RECORD; i INTEGER := 0; total_m DOUBLE PRECISION := 0; gaps DOUBLE PRECISION[] := '{}';
  med DOUBLE PRECISION; the_mode TEXT; pace_kmh DOUBLE PRECISION; stop_s DOUBLE PRECISION; minutes INTEGER;
  path JSONB := '[]'::jsonb; first_addr TEXT; line_json JSONB; strays INTEGER := 0; pass INTEGER;
  leg_line geometry; passed RECORD; cur_edge BIGINT; nxt_edge BIGINT; on_roads BOOLEAN := false;
  n_comp INTEGER; n_more INTEGER; biggest BIGINT; gap RECORD; gb BOX; added INTEGER; bridge_pass INTEGER; margin DOUBLE PRECISION;
  jump_m DOUBLE PRECISION := 0; walk_m DOUBLE PRECISION := 0;
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
  -- The real roads from OpenStreetMap when they have been read, which
  -- join the streets USPS draws as islands; USPS's own lines otherwise.
  -- Only the roads within three hundred metres of a door: a handful of
  -- farms kilometres apart would otherwise bring in every lane of the
  -- countryside between them, more than can be noded in the time.
  DROP TABLE IF EXISTS zw_near;
  CREATE TEMP TABLE zw_near ON COMMIT DROP AS
  SELECT box(point(ST_X(ll) * kx - 300, ST_Y(ll) * ky - 300), point(ST_X(ll) * kx + 300, ST_Y(ll) * ky + 300)) AS b FROM zw_pts;
  DROP TABLE IF EXISTS zw_raw;
  CREATE TEMP TABLE zw_raw ON COMMIT DROP AS
  SELECT s.id AS rid, ST_Transform(ST_SetSRID(ST_MakeLine(
           ST_MakePoint((s.seg[0])[0] / kx, (s.seg[0])[1] / ky),
           ST_MakePoint((s.seg[1])[0] / kx, (s.seg[1])[1] / ky)), 4326), 26985) AS g
  FROM road_segments s
  WHERE s.organization_id = org AND s.bbox && box(point(minx, miny), point(maxx, maxy))
    AND EXISTS (SELECT 1 FROM zw_near nb WHERE s.bbox && nb.b)
    -- Sidewalks are drawn a piece every ten metres beside every street
    -- and outnumber the streets four to one; the street is enough.
    AND s.highway IS DISTINCT FROM 'footway';
  SELECT count(*) INTO n_streets FROM zw_raw;
  CREATE INDEX ON zw_raw (rid);
  on_roads := n_streets > 0;
  IF NOT on_roads THEN
    INSERT INTO zw_raw (g)
    SELECT ST_Transform(ST_SetSRID(ST_MakeLine(
             ST_MakePoint((s.seg[0])[0] / kx, (s.seg[0])[1] / ky),
             ST_MakePoint((s.seg[1])[0] / kx, (s.seg[1])[1] / ky)), 4326), 26985)
    FROM eddm_segments s
    WHERE s.organization_id = org AND s.bbox && box(point(minx, miny), point(maxx, maxy));
    SELECT count(*) INTO n_streets FROM zw_raw;
  END IF;
  IF n_streets = 0 THEN RETURN zone_walk_straight(the_zone); END IF;

  -- One network: split where streets cross. USPS draws a road served
  -- from both sides twice, a few metres apart, so its ends are matched
  -- to eight metres; that matching is the square of the pieces, and the
  -- roads from OpenStreetMap, which meet exactly, are noded alone. When
  -- the roads near the doors leave islands (two clusters of doors with
  -- the road between them outside three hundred metres of any door),
  -- the roads in the box between each island and the nearest other are
  -- brought in and the network is built again, up to three times.
  FOR pass IN 1..3 LOOP
    DROP TABLE IF EXISTS zw_edges;
    CREATE TEMP TABLE zw_edges (id BIGSERIAL, geom geometry, source BIGINT, target BIGINT, cost DOUBLE PRECISION, reverse_cost DOUBLE PRECISION) ON COMMIT DROP;
    IF on_roads THEN
      INSERT INTO zw_edges (geom)
      SELECT (d).geom FROM (SELECT ST_Dump(ST_Node(c)) AS d FROM (SELECT ST_Collect(g) AS c FROM zw_raw) cc) x WHERE ST_Length((d).geom) > 0.05;
    ELSE
      INSERT INTO zw_edges (geom)
      SELECT (d).geom FROM (SELECT ST_Dump(ST_Node(ST_Snap(c, c, 8.0))) AS d FROM (SELECT ST_Collect(g) AS c FROM zw_raw) cc) x WHERE ST_Length((d).geom) > 0.05;
    END IF;
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

    -- Islands joined across the road nobody drew: each island to the
    -- nearest street of another. Sixty metres first, which is a road
    -- USPS left out; then a hundred and fifty, which is the driveway or
    -- the cut-through that hangs a parking aisle off the street. Beyond
    -- that it is not a road, and the round is cut instead.
    FOR bridge_pass IN 1..6 LOOP
      DROP TABLE IF EXISTS zw_comp;
      CREATE TEMP TABLE zw_comp ON COMMIT DROP AS
      SELECT node, component FROM pgr_connectedComponents('SELECT id, source, target, cost FROM zw_edges');
      CREATE INDEX ON zw_comp (node);
      SELECT count(DISTINCT component) INTO n_comp FROM zw_comp;
      EXIT WHEN n_comp <= 1;
      INSERT INTO zw_edges (geom, source, target, cost, reverse_cost)
      SELECT ST_MakeLine(ag, bg), av, bv, ST_Distance(ag, bg) * 1.5, ST_Distance(ag, bg) * 1.5
      FROM (
        SELECT DISTINCT ON (ca.component) ca.component, a.vid AS av, a.geom AS ag, b.vid AS bv, b.geom AS bg
        FROM zw_nodes a JOIN zw_comp ca ON ca.node = a.vid
        JOIN LATERAL (
          SELECT b.vid, b.geom FROM zw_nodes b JOIN zw_comp cb ON cb.node = b.vid
          WHERE cb.component <> ca.component AND ST_DWithin(a.geom, b.geom, CASE WHEN bridge_pass <= 4 THEN 60 ELSE 150 END)
          ORDER BY a.geom <-> b.geom LIMIT 1) b ON true
        ORDER BY ca.component, ST_Distance(a.geom, b.geom)) bridges;
      EXIT WHEN NOT FOUND;
    END LOOP;
    DROP TABLE IF EXISTS zw_comp;
    CREATE TEMP TABLE zw_comp ON COMMIT DROP AS
    SELECT node, component FROM pgr_connectedComponents('SELECT id, source, target, cost FROM zw_edges');
    CREATE INDEX ON zw_comp (node);
    SELECT count(DISTINCT component) INTO n_comp FROM zw_comp;
    EXIT WHEN n_comp <= 1 OR NOT on_roads OR pass = 3;

    -- Every island but the biggest, to the nearest node of any other.
    SELECT component INTO biggest FROM zw_comp GROUP BY component ORDER BY count(*) DESC LIMIT 1;
    DROP TABLE IF EXISTS zw_gap;
    CREATE TEMP TABLE zw_gap ON COMMIT DROP AS
    SELECT DISTINCT ON (ca.component) ca.component, ST_Transform(a.geom, 4326) AS ag, ST_Transform(b.geom, 4326) AS bg
    FROM zw_nodes a JOIN zw_comp ca ON ca.node = a.vid
    JOIN LATERAL (
      SELECT b.geom FROM zw_nodes b JOIN zw_comp cb ON cb.node = b.vid
      WHERE cb.component <> ca.component
      ORDER BY a.geom <-> b.geom LIMIT 1) b ON true
    WHERE ca.component <> biggest
    ORDER BY ca.component, ST_Distance(a.geom, b.geom);
    added := 0;
    FOR gap IN SELECT * FROM zw_gap LOOP
      -- The road between two islands seldom runs straight between them:
      -- it goes round a golf course or a school, so the box is as wide
      -- about the line as half the gap is long.
      margin := greatest(200.0, 0.5 * sqrt(((ST_X(gap.ag) - ST_X(gap.bg)) * kx) ^ 2 + ((ST_Y(gap.ag) - ST_Y(gap.bg)) * ky) ^ 2));
      gb := box(point(least(ST_X(gap.ag), ST_X(gap.bg)) * kx - margin, least(ST_Y(gap.ag), ST_Y(gap.bg)) * ky - margin),
                point(greatest(ST_X(gap.ag), ST_X(gap.bg)) * kx + margin, greatest(ST_Y(gap.ag), ST_Y(gap.bg)) * ky + margin));
      -- A box that is the countryside between two farms is left alone: the
      -- round is cut there instead, and that zone is driven anyway.
      SELECT count(*) INTO n_more FROM road_segments s
      WHERE s.organization_id = org AND s.bbox && gb AND s.highway IS DISTINCT FROM 'footway';
      CONTINUE WHEN n_more > 6000;
      INSERT INTO zw_raw (rid, g)
      SELECT s.id, ST_Transform(ST_SetSRID(ST_MakeLine(
               ST_MakePoint((s.seg[0])[0] / kx, (s.seg[0])[1] / ky),
               ST_MakePoint((s.seg[1])[0] / kx, (s.seg[1])[1] / ky)), 4326), 26985)
      FROM road_segments s
      WHERE s.organization_id = org AND s.bbox && gb AND s.highway IS DISTINCT FROM 'footway'
        AND NOT EXISTS (SELECT 1 FROM zw_raw r WHERE r.rid = s.id);
      GET DIAGNOSTICS n_more = ROW_COUNT;
      added := added + n_more;
    END LOOP;
    EXIT WHEN added = 0;
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
    SELECT p.pid, p.address, p.ll, p.g, c.agg_cost AS cost, false AS guessed INTO nxt
    FROM zw_cost c JOIN zw_pts p ON p.pid = -c.end_vid
    WHERE c.start_vid = -cur AND NOT p.done
    ORDER BY c.agg_cost LIMIT 1;
    IF NOT FOUND THEN
      SELECT p.pid, p.address, p.ll, p.g, ST_Distance(p.g, cur_g) * 1.3 AS cost, true AS guessed INTO nxt
      FROM zw_pts p WHERE NOT p.done ORDER BY p.g <-> cur_g LIMIT 1;
      EXIT WHEN NOT FOUND;
    END IF;

    -- The doors passed on the way there are taken in passing, in the
    -- order met, rather than walked past and come back for. The way is
    -- the street between the two; a door whose curb is on it is on the way.
    IF NOT nxt.guessed THEN
      SELECT edge_id INTO cur_edge FROM zw_curb WHERE pid = cur;
      SELECT edge_id INTO nxt_edge FROM zw_curb WHERE pid = nxt.pid;
      IF cur_edge = nxt_edge THEN
        SELECT ST_MakeLine(a.g, b.g) INTO leg_line FROM zw_curb a, zw_curb b WHERE a.pid = cur AND b.pid = nxt.pid;
      ELSE
        SELECT ST_MakeLine(pos ORDER BY s.seq) INTO leg_line FROM (
          SELECT w.seq, (SELECT c.g FROM zw_curb c WHERE c.pid = -w.node UNION ALL SELECT nd.geom FROM zw_nodes nd WHERE nd.vid = w.node LIMIT 1) AS pos
          FROM pgr_withPoints('SELECT id, source, target, cost, reverse_cost FROM zw_edges', 'SELECT pid, edge_id, fraction, side FROM zw_curb',
                              -cur, -nxt.pid, directed := false, driving_side := 'b', details := false) w) s;
      END IF;
      IF leg_line IS NOT NULL AND ST_GeometryType(leg_line) = 'ST_LineString' AND ST_NPoints(leg_line) >= 2 THEN
        FOR passed IN
          SELECT p.pid, p.address, p.ll, p.g FROM zw_curb c JOIN zw_pts p ON p.pid = c.pid
          WHERE NOT p.done AND c.pid <> nxt.pid AND ST_DWithin(c.g, leg_line, 0.5)
          ORDER BY ST_LineLocatePoint(leg_line, c.g)
        LOOP
          i := i + 1;
          IF i = 1 THEN first_addr := passed.address; END IF;
          INSERT INTO zw_legs (seq, source, target, guess_m) VALUES (i, -cur, -passed.pid, ST_Distance(passed.g, cur_g) * 1.3);
          path := path || jsonb_build_object('lat', round(ST_Y(passed.ll)::numeric, 6), 'lng', round(ST_X(passed.ll)::numeric, 6));
          UPDATE zw_pts SET done = true WHERE pid = passed.pid;
          cur := passed.pid; cur_g := passed.g;
        END LOOP;
      END IF;
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
  -- A leg no street joins is a gap in the round: it is driven, and it is
  -- not drawn, because there is no way there to draw.
  UPDATE zw_legs l SET straight = NOT l.same_edge AND NOT EXISTS (SELECT 1 FROM zw_steps st WHERE st.leg = l.seq);
  SELECT count(*), coalesce(sum(guess_m), 0) INTO strays, jump_m FROM zw_legs WHERE straight;

  -- Each leg's length: the street, plus the way up to the door (a long
  -- drive is not walked to its end: thirty metres of it at most).
  DROP TABLE IF EXISTS zw_leg_m;
  CREATE TEMP TABLE zw_leg_m ON COMMIT DROP AS
  SELECT l.seq, l.straight,
         CASE WHEN l.same_edge THEN (SELECT abs(a.fraction - b.fraction) * ST_Length(e.geom) FROM zw_curb a, zw_curb b, zw_edges e WHERE a.pid = -l.source AND b.pid = -l.target AND e.id = a.edge_id)
              WHEN l.straight THEN l.guess_m
              ELSE (SELECT max(st.agg_cost) FROM zw_steps st WHERE st.leg = l.seq) END
         + CASE WHEN -l.target = n + 1 THEN 0 ELSE least((SELECT off_m FROM zw_curb WHERE pid = -l.target), 30) END AS m
  FROM zw_legs l;
  SELECT coalesce(sum(m), 0), coalesce(sum(m) FILTER (WHERE NOT straight), 0) INTO total_m, walk_m FROM zw_leg_m;
  SELECT coalesce(array_agg(m ORDER BY seq), '{}') INTO gaps FROM zw_leg_m WHERE seq > 1 AND seq <= i;

  -- Every street piece is a straight segment (USPS draws them so, and
  -- noding only cuts them), so the way from one stop to the next along a
  -- piece is the line between where the two are: a corner, or a door's
  -- curb. That is the whole geometry, with no edge bookkeeping to get
  -- wrong. A gap ends the run and the next piece starts a new one, so
  -- nothing is ever drawn across it.
  CREATE INDEX ON zw_nodes (vid);
  DROP TABLE IF EXISTS zw_runs;
  CREATE TEMP TABLE zw_runs ON COMMIT DROP AS
  WITH pieces AS (
    SELECT st.leg, st.path_seq, ST_MakeLine(pu.g, pv.g) AS piece, false AS brk
    FROM zw_steps st
    JOIN LATERAL (SELECT c.g FROM zw_curb c WHERE c.pid = -st.node UNION ALL SELECT nd.geom FROM zw_nodes nd WHERE nd.vid = st.node LIMIT 1) pu ON true
    JOIN LATERAL (SELECT c.g FROM zw_curb c WHERE c.pid = -st.next_node UNION ALL SELECT nd.geom FROM zw_nodes nd WHERE nd.vid = st.next_node LIMIT 1) pv ON true
    WHERE st.next_node IS NOT NULL
  ),
  same_edge AS (
    SELECT l.seq AS leg, 0 AS path_seq, ST_MakeLine(a.g, b.g) AS piece, false AS brk
    FROM zw_legs l JOIN zw_curb a ON a.pid = -l.source JOIN zw_curb b ON b.pid = -l.target
    WHERE l.same_edge
  ),
  breaks AS (
    SELECT l.seq AS leg, 0 AS path_seq, NULL::geometry AS piece, true AS brk
    FROM zw_legs l WHERE l.straight
  ),
  -- Joined strictly in walking order. A merge by shared ends would put
  -- the pieces back in its own order wherever the walk passes a corner
  -- twice, and the line would leap across the zone between them.
  ordered AS (
    SELECT leg, path_seq, piece, brk,
           sum(CASE WHEN brk THEN 1 ELSE 0 END) OVER (ORDER BY leg, path_seq ROWS UNBOUNDED PRECEDING) AS run
    FROM (SELECT * FROM pieces UNION ALL SELECT * FROM same_edge UNION ALL SELECT * FROM breaks) all_pieces
  )
  SELECT run, ST_Simplify(ST_MakeLine(array_agg(piece ORDER BY leg, path_seq)), 0.4) AS g
  FROM ordered
  WHERE NOT brk AND piece IS NOT NULL AND NOT ST_IsEmpty(piece)
  GROUP BY run;

  SELECT jsonb_agg(pts ORDER BY run) INTO line_json FROM (
    SELECT r.run,
           (SELECT jsonb_agg(jsonb_build_array(round(ST_X(dp.geom)::numeric, 6), round(ST_Y(dp.geom)::numeric, 6)) ORDER BY dp.path)
            FROM ST_DumpPoints(ST_Transform(r.g, 4326)) dp) AS pts
    FROM zw_runs r WHERE r.g IS NOT NULL AND ST_NPoints(r.g) >= 2) q
  WHERE pts IS NOT NULL;
  -- One run is the round as it always was: a list of points. More than
  -- one is a list of runs, and the gaps between them are not drawn.
  IF line_json IS NOT NULL AND jsonb_array_length(line_json) = 0 THEN line_json := NULL; END IF;
  IF line_json IS NOT NULL AND jsonb_array_length(line_json) = 1 THEN line_json := line_json->0; END IF;

  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY v) INTO med FROM unnest(gaps) v;
  med := coalesce(med, 0);
  -- Along the streets a suburban door is thirty-odd metres from the next
  -- once the way up to it is counted; the thresholds are for that.
  the_mode := CASE WHEN total_m / n <= 55 THEN 'foot' WHEN total_m / n <= 110 THEN 'scooter' ELSE 'vehicle' END;
  pace_kmh := CASE the_mode WHEN 'foot' THEN 4.0 WHEN 'scooter' THEN 12.0 ELSE 25.0 END;
  stop_s := CASE the_mode WHEN 'foot' THEN 25 WHEN 'scooter' THEN 30 ELSE 45 END;
  -- The gaps are driven, not walked, however the rest of the round goes.
  minutes := round((walk_m / 1000.0) / pace_kmh * 60 + (jump_m / 1000.0) / 30.0 * 60 + n * stop_s / 60.0);

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
    walk_breaks = strays,
    walk_jump_m = round(jump_m::numeric, 1),
    walked_at = now(),
    updated_at = now()
  WHERE id = the_zone;

  RETURN jsonb_build_object('houses', n, 'pathKm', round((total_m / 1000.0)::numeric, 2), 'medianGapM', round(med::numeric, 1),
    'mode', the_mode, 'streets', true, 'roads', on_roads, 'minutes', minutes, 'strays', strays,
    'jumpM', round(jump_m::numeric, 1), 'runs', CASE WHEN line_json IS NULL THEN 0 WHEN jsonb_typeof(line_json->0->0) = 'array' THEN jsonb_array_length(line_json) ELSE 1 END,
    'edges', (SELECT count(*) FROM zw_edges));
END $function$;

-- Every zone walked again on the new rule.
UPDATE public.hanger_zones SET walked_at = NULL WHERE walk_path IS NOT NULL;

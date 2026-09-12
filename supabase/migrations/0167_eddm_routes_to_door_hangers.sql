-- USPS carrier routes become the door-hanger routes, without anybody drawing.
--
-- A carrier route is a neighbourhood a person walks every day, which is
-- exactly what a door-hanger walk is. So every walkable route becomes a wave
-- of a new system type, Door Hangers, and a zone with its houses attached;
-- every house is assigned to the route whose streets run past it; and the
-- houses no route's streets come within sixty metres of are flagged, because
-- a few of them are doors the walk should take in and a lot of them is a
-- development USPS has not caught up with yet.
--
-- Distances are done in metres in a local flat projection -- Harford County
-- is small enough that a single cosine is honest -- with the route streets
-- cut into line segments and boxed for a GiST index, so finding the nearest
-- street to a hundred thousand houses is an index walk and not a product.

INSERT INTO attractor_types (id, label, is_system)
VALUES ('door_hangers', 'Door Hangers', true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE eddm_routes
  -- USPS's own route type: C city, R rural, H highway contract, B boxes.
  ADD COLUMN IF NOT EXISTS route_type TEXT,
  -- walkable | hard | unknown, and why.
  ADD COLUMN IF NOT EXISTS walkability TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS walkability_reason TEXT,
  -- The main roads found along the route, from the map's road classes.
  ADD COLUMN IF NOT EXISTS main_roads JSONB,
  ADD COLUMN IF NOT EXISTS wave_id UUID REFERENCES attractor_waves(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS zone_id UUID REFERENCES hanger_zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS house_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE houses
  ADD COLUMN IF NOT EXISTS eddm_route_id UUID REFERENCES eddm_routes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS eddm_route_distance_m REAL,
  -- No route's streets come near this house.
  ADD COLUMN IF NOT EXISTS eddm_unserved BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS houses_eddm_route_idx ON houses (eddm_route_id);
CREATE INDEX IF NOT EXISTS houses_eddm_unserved_idx ON houses (organization_id) WHERE eddm_unserved;

-- The streets, one straight piece at a time, in metres.
CREATE TABLE IF NOT EXISTS eddm_segments (
  id BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,
  route_id UUID NOT NULL REFERENCES eddm_routes(id) ON DELETE CASCADE,
  zip TEXT NOT NULL,
  seg LSEG NOT NULL,
  bbox BOX NOT NULL
);
CREATE INDEX IF NOT EXISTS eddm_segments_bbox_idx ON eddm_segments USING gist (bbox);
CREATE INDEX IF NOT EXISTS eddm_segments_zip_idx ON eddm_segments (organization_id, zip);

CREATE OR REPLACE FUNCTION eddm_to_metres(lng DOUBLE PRECISION, lat DOUBLE PRECISION)
RETURNS POINT LANGUAGE sql IMMUTABLE AS $$
  SELECT point(lng * cos(radians(39.5)) * 111320.0, lat * 110574.0);
$$;

CREATE OR REPLACE FUNCTION eddm_rebuild_segments(org UUID, the_zip TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  r RECORD; p JSONB; i INTEGER; n INTEGER := 0; a POINT; b POINT;
BEGIN
  DELETE FROM eddm_segments s WHERE s.organization_id = org AND s.zip = the_zip;
  FOR r IN SELECT id, paths FROM eddm_routes WHERE organization_id = org AND zip = the_zip AND paths IS NOT NULL LOOP
    FOR p IN SELECT * FROM jsonb_array_elements(r.paths) LOOP
      FOR i IN 0 .. jsonb_array_length(p) - 2 LOOP
        a := eddm_to_metres((p->i->>0)::double precision, (p->i->>1)::double precision);
        b := eddm_to_metres((p->(i+1)->>0)::double precision, (p->(i+1)->>1)::double precision);
        INSERT INTO eddm_segments (organization_id, route_id, zip, seg, bbox)
        VALUES (org, r.id, the_zip, lseg(a, b), box(a, b));
        n := n + 1;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN n;
END $$;

-- Every house in a ZIP to the route whose street is nearest, within max_m.
CREATE OR REPLACE FUNCTION eddm_assign_houses(org UUID, the_zip TEXT, max_m DOUBLE PRECISION DEFAULT 60)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE assigned INTEGER; unserved INTEGER;
BEGIN
  WITH candidates AS (
    SELECT h.id AS house_id,
           (SELECT s.route_id FROM eddm_segments s
             WHERE s.organization_id = org
               AND s.bbox && box(eddm_to_metres(h.lng::double precision - 0.001, h.lat::double precision - 0.001),
                                 eddm_to_metres(h.lng::double precision + 0.001, h.lat::double precision + 0.001))
             ORDER BY s.seg <-> eddm_to_metres(h.lng::double precision, h.lat::double precision)
             LIMIT 1) AS route_id,
           (SELECT s.seg <-> eddm_to_metres(h.lng::double precision, h.lat::double precision) FROM eddm_segments s
             WHERE s.organization_id = org
               AND s.bbox && box(eddm_to_metres(h.lng::double precision - 0.001, h.lat::double precision - 0.001),
                                 eddm_to_metres(h.lng::double precision + 0.001, h.lat::double precision + 0.001))
             ORDER BY s.seg <-> eddm_to_metres(h.lng::double precision, h.lat::double precision)
             LIMIT 1) AS dist
    FROM houses h
    WHERE h.organization_id = org AND h.kind = 'house' AND NOT h.needs_review
      AND NOT (h.lat = 0 AND h.lng = 0)
      AND right(h.normalized_address, 5) = the_zip
  )
  UPDATE houses h SET
    eddm_route_id = CASE WHEN c.dist IS NOT NULL AND c.dist <= max_m THEN c.route_id ELSE NULL END,
    eddm_route_distance_m = c.dist,
    eddm_unserved = (c.dist IS NULL OR c.dist > max_m)
  FROM candidates c WHERE c.house_id = h.id;

  SELECT count(*) FILTER (WHERE eddm_route_id IS NOT NULL), count(*) FILTER (WHERE eddm_unserved)
    INTO assigned, unserved
  FROM houses h WHERE h.organization_id = org AND h.kind = 'house' AND NOT h.needs_review
    AND right(h.normalized_address, 5) = the_zip;

  UPDATE eddm_routes r SET house_count = (SELECT count(*) FROM houses h WHERE h.eddm_route_id = r.id)
  WHERE r.organization_id = org AND r.zip = the_zip;

  RETURN jsonb_build_object('assigned', assigned, 'unserved', unserved);
END $$;

-- One hanger route per ZIP, one zone per walkable USPS route, its houses attached.
CREATE OR REPLACE FUNCTION eddm_materialize_zones(org UUID, the_zip TEXT)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r RECORD; route_row_id UUID; zone_row_id UUID; made INTEGER := 0; pos INTEGER := 0; ring JSONB;
BEGIN
  SELECT id INTO route_row_id FROM hanger_routes WHERE organization_id = org AND name = 'USPS ' || the_zip LIMIT 1;
  IF route_row_id IS NULL THEN
    INSERT INTO hanger_routes (organization_id, name, status, notes)
    VALUES (org, 'USPS ' || the_zip, 'planned', 'Built from USPS carrier routes. One zone per walkable route.')
    RETURNING id INTO route_row_id;
  END IF;

  FOR r IN SELECT id, route_id, rings, zone_id FROM eddm_routes
           WHERE organization_id = org AND zip = the_zip AND walkability = 'walkable' ORDER BY route_id LOOP
    pos := pos + 1;
    SELECT jsonb_agg(jsonb_build_object('lng', v->0, 'lat', v->1)) INTO ring FROM jsonb_array_elements(r.rings->0) v;
    IF r.zone_id IS NULL THEN
      INSERT INTO hanger_zones (organization_id, route_id, name, geometry_type, geometry, position, boundary)
      VALUES (org, route_row_id, the_zip || ' ' || r.route_id, 'polygon', jsonb_build_object('points', ring), pos, ring)
      RETURNING id INTO zone_row_id;
      UPDATE eddm_routes SET zone_id = zone_row_id WHERE id = r.id;
      made := made + 1;
    ELSE
      zone_row_id := r.zone_id;
      UPDATE hanger_zones SET position = pos, boundary = ring, geometry = jsonb_build_object('points', ring), updated_at = now() WHERE id = zone_row_id;
    END IF;
    INSERT INTO zone_houses (zone_id, house_id)
    SELECT zone_row_id, h.id FROM houses h WHERE h.eddm_route_id = r.id
    ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN jsonb_build_object('zones_created', made, 'zones', pos);
END $$;

-- The houses no route reaches, bucketed into cells of roughly 150 metres.
-- Neighbouring cells are joined into developments by the app.
CREATE OR REPLACE FUNCTION eddm_unserved_cells(org UUID)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'cx', cx, 'cy', cy, 'count', n, 'lat', round(clat::numeric, 6), 'lng', round(clng::numeric, 6), 'sample', sample, 'zip', zip
  )), '[]'::jsonb)
  FROM (
    SELECT floor(h.lng::double precision / 0.0018) AS cx, floor(h.lat::double precision / 0.0014) AS cy,
           count(*) AS n, avg(h.lat::double precision) AS clat, avg(h.lng::double precision) AS clng,
           min(h.address) AS sample, right(min(h.normalized_address), 5) AS zip
    FROM houses h
    WHERE h.organization_id = org AND h.eddm_unserved AND h.kind = 'house' AND NOT h.needs_review
    GROUP BY 1, 2
  ) cells;
$$;

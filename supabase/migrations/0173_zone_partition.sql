-- Zones as a partition of the county: no overlaps, no house left out.
--
-- A USPS route's streets, hulled, made zones that overlapped at their edges
-- and left the houses between routes to nobody. A zone is now a set of
-- houses -- every house in exactly one -- and its outline is the union of
-- the Voronoi cells of its houses, each cell trimmed to a disk around its
-- house. Cells of different houses never overlap, so neither do zones; a
-- house is always inside its own cell and disk, so none is left out.
-- Houses no route reaches join the zone of the nearest house that has one.
--
-- PostGIS does the geometry. Everything here is idempotent per ZIP and per
-- route, and small enough per call to run through the API.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE OR REPLACE FUNCTION public.house_geom(lng NUMERIC, lat NUMERIC)
RETURNS public.geometry LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ST_SetSRID(ST_MakePoint(lng::double precision, lat::double precision), 4326);
$$;
CREATE INDEX IF NOT EXISTS houses_geom_idx ON public.houses USING gist (public.house_geom(lng, lat));

ALTER TABLE public.hanger_zones
  ADD COLUMN IF NOT EXISTS eddm_route_id UUID REFERENCES public.eddm_routes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS zip TEXT,
  -- foot | scooter | vehicle, from how far apart the doors are.
  ADD COLUMN IF NOT EXISTS mode TEXT,
  ADD COLUMN IF NOT EXISTS house_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS path_km REAL,
  ADD COLUMN IF NOT EXISTS est_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS median_gap_m REAL,
  -- The full outline, which may be several pieces, as GeoJSON.
  ADD COLUMN IF NOT EXISTS boundary_geojson JSONB,
  ADD COLUMN IF NOT EXISTS built_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS hanger_zones_eddm_route_idx ON public.hanger_zones (eddm_route_id);

-- A house belongs to one zone. The hull-based zones put some in two; the
-- membership is rebuilt below anyway, so the duplicates go first.
DELETE FROM public.zone_houses a USING public.zone_houses b
WHERE a.house_id = b.house_id AND a.ctid < b.ctid;
CREATE UNIQUE INDEX IF NOT EXISTS zone_houses_house_idx ON public.zone_houses (house_id);

-- 1. Every house in a ZIP onto a route: its own, or the nearest housed one.
--    Returns how many were adopted by a neighbour's route.
CREATE OR REPLACE FUNCTION public.zone_adopt_leftovers(org UUID, the_zip TEXT)
RETURNS INTEGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n INTEGER;
BEGIN
  WITH orphans AS (
    SELECT h.id, house_geom(h.lng, h.lat) AS g FROM houses h
    WHERE h.organization_id = org AND h.kind = 'house' AND NOT h.needs_review AND NOT (h.lat = 0 AND h.lng = 0)
      AND right(h.normalized_address, 5) = the_zip AND h.eddm_route_id IS NULL
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

-- 2. A zone for every route in the ZIP, hard or walkable, with its houses.
CREATE OR REPLACE FUNCTION public.zone_ensure(org UUID, the_zip TEXT)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE r RECORD; route_row_id UUID; zone_row_id UUID; made INTEGER := 0; pos INTEGER := 0; members INTEGER := 0;
BEGIN
  SELECT id INTO route_row_id FROM hanger_routes WHERE organization_id = org AND name = 'USPS ' || the_zip LIMIT 1;
  IF route_row_id IS NULL THEN
    INSERT INTO hanger_routes (organization_id, name, status, notes)
    VALUES (org, 'USPS ' || the_zip, 'planned', 'One zone per USPS carrier route; every house in exactly one zone.')
    RETURNING id INTO route_row_id;
  END IF;

  FOR r IN SELECT id, route_id, zone_id FROM eddm_routes WHERE organization_id = org AND zip = the_zip ORDER BY route_id LOOP
    pos := pos + 1;
    IF r.zone_id IS NULL OR NOT EXISTS (SELECT 1 FROM hanger_zones z WHERE z.id = r.zone_id) THEN
      INSERT INTO hanger_zones (organization_id, route_id, name, geometry_type, geometry, position, eddm_route_id, zip)
      VALUES (org, route_row_id, the_zip || ' ' || r.route_id, 'polygon', '{"points":[]}'::jsonb, pos, r.id, the_zip)
      RETURNING id INTO zone_row_id;
      UPDATE eddm_routes SET zone_id = zone_row_id WHERE id = r.id;
      made := made + 1;
    ELSE
      zone_row_id := r.zone_id;
      UPDATE hanger_zones SET position = pos, eddm_route_id = r.id, zip = the_zip, route_id = route_row_id, updated_at = now() WHERE id = zone_row_id;
    END IF;
    -- Membership follows the route assignment exactly: out with the old.
    DELETE FROM zone_houses zh WHERE zh.zone_id = zone_row_id
      AND NOT EXISTS (SELECT 1 FROM houses h WHERE h.id = zh.house_id AND h.eddm_route_id = r.id);
    DELETE FROM zone_houses zh USING houses h WHERE zh.house_id = h.id AND h.eddm_route_id = r.id AND zh.zone_id <> zone_row_id;
    INSERT INTO zone_houses (zone_id, house_id)
    SELECT zone_row_id, h.id FROM houses h WHERE h.eddm_route_id = r.id AND h.kind = 'house' AND NOT h.needs_review
    ON CONFLICT DO NOTHING;
    UPDATE hanger_zones SET house_count = (SELECT count(*) FROM zone_houses WHERE zone_id = zone_row_id) WHERE id = zone_row_id;
    members := members + (SELECT count(*) FROM zone_houses WHERE zone_id = zone_row_id);
  END LOOP;
  RETURN jsonb_build_object('zones', pos, 'created', made, 'houses', members);
END $$;

-- 3. One zone's outline: the union of its houses' Voronoi cells, each cell
--    trimmed to a disk of `reach` metres around its house. The cells are
--    computed with every neighbouring house within `context` metres as a
--    site too, so a cell near the zone's edge is exactly what a countywide
--    Voronoi would give, and the neighbour's zone cannot overlap it.
CREATE OR REPLACE FUNCTION public.zone_outline(the_zone UUID, reach DOUBLE PRECISION DEFAULT 200, context DOUBLE PRECISION DEFAULT 600)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  org UUID; env geometry; sites geometry; cells geometry; outline geometry; pieces INTEGER; ring JSONB; n_sites INTEGER;
BEGIN
  SELECT z.organization_id INTO org FROM hanger_zones z WHERE z.id = the_zone;
  -- The zone's own houses, boxed and widened by the context.
  SELECT ST_Expand(ST_Extent(house_geom(h.lng, h.lat))::geometry, context / 111000.0)
    INTO env
  FROM zone_houses zh JOIN houses h ON h.id = zh.house_id WHERE zh.zone_id = the_zone;
  IF env IS NULL THEN
    UPDATE hanger_zones SET boundary = NULL, boundary_geojson = NULL, built_at = now() WHERE id = the_zone;
    RETURN jsonb_build_object('pieces', 0, 'houses', 0);
  END IF;

  -- Every housed point in the box: ours and the neighbours'.
  CREATE TEMP TABLE IF NOT EXISTS zo_sites (house_id UUID, zone_id UUID, g geometry) ON COMMIT DROP;
  TRUNCATE zo_sites;
  INSERT INTO zo_sites
  SELECT h.id, zh.zone_id, house_geom(h.lng, h.lat)
  FROM houses h JOIN zone_houses zh ON zh.house_id = h.id
  WHERE h.organization_id = org AND house_geom(h.lng, h.lat) && env;
  SELECT count(*) INTO n_sites FROM zo_sites;

  IF n_sites < 3 THEN
    -- Too few points for cells: disks alone.
    SELECT ST_Union(ST_Buffer(s.g::geography, reach)::geometry) INTO outline FROM zo_sites s WHERE s.zone_id = the_zone;
  ELSE
    SELECT ST_Collect(g) INTO sites FROM zo_sites;
    SELECT ST_VoronoiPolygons(sites, 0.0, ST_Expand(env, 0.01)) INTO cells;
    CREATE TEMP TABLE IF NOT EXISTS zo_cells (cell geometry) ON COMMIT DROP;
    TRUNCATE zo_cells;
    INSERT INTO zo_cells SELECT (ST_Dump(cells)).geom;
    CREATE INDEX IF NOT EXISTS zo_cells_idx ON zo_cells USING gist (cell);
    -- A house on a cell edge (two houses at one point, say) is covered by
    -- intersects, not contains, so every house gets a piece.
    SELECT ST_Union(ST_Intersection(c.cell, ST_Buffer(s.g::geography, reach)::geometry))
      INTO outline
    FROM zo_sites s JOIN zo_cells c ON ST_Intersects(c.cell, s.g)
    WHERE s.zone_id = the_zone;
  END IF;

  -- Not simplified: two zones share an edge exactly only if neither is
  -- moved on its own.
  outline := ST_CollectionExtract(ST_MakeValid(outline), 3);
  pieces := ST_NumGeometries(outline);
  -- The biggest piece's outer ring, for the screens that draw one ring.
  SELECT jsonb_agg(jsonb_build_object('lng', ST_X(p.geom), 'lat', ST_Y(p.geom)) ORDER BY p.path)
    INTO ring
  FROM ST_DumpPoints(ST_ExteriorRing(ST_GeometryN(outline, (
    SELECT i FROM generate_series(1, pieces) i ORDER BY ST_Area(ST_GeometryN(outline, i)) DESC LIMIT 1)))) p;

  UPDATE hanger_zones SET
    boundary = ring,
    geometry = jsonb_build_object('points', ring),
    geometry_type = 'polygon',
    boundary_geojson = ST_AsGeoJSON(outline, 9)::jsonb,
    built_at = now(),
    updated_at = now()
  WHERE id = the_zone;
  -- The wave made from the route keeps the same outline, so its counts agree.
  UPDATE attractor_waves w SET geometry = jsonb_build_object('points', ring), geometry_type = 'polygon', updated_at = now()
  FROM eddm_routes r JOIN hanger_zones z ON z.eddm_route_id = r.id
  WHERE z.id = the_zone AND w.id = r.wave_id;

  RETURN jsonb_build_object('pieces', pieces, 'sites', n_sites, 'houses', (SELECT count(*) FROM zo_sites WHERE zone_id = the_zone));
END $$;

-- The zones as the map draws them: outline, mode, counts, parking.
CREATE OR REPLACE FUNCTION public.zones_geojson(org UUID)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(jsonb_build_object(
    'type', 'Feature',
    'geometry', z.boundary_geojson,
    'properties', jsonb_build_object(
      'id', z.id, 'name', z.name, 'zip', z.zip, 'mode', z.mode, 'houses', z.house_count,
      'pathKm', z.path_km, 'minutes', z.est_minutes, 'gapM', z.median_gap_m,
      'park', z.park_point, 'start', z.start_point, 'startAddress', z.start_address,
      'routeId', r.route_id, 'walkability', r.walkability, 'reason', r.walkability_reason,
      'waveId', r.wave_id, 'clients', (SELECT count(*) FROM zone_houses zh JOIN property_events e ON e.house_id = zh.house_id
                                        WHERE zh.zone_id = z.id AND e.kind IN ('client', 'job_completed')))
  )), '[]'::jsonb))
  FROM hanger_zones z LEFT JOIN eddm_routes r ON r.id = z.eddm_route_id
  WHERE z.organization_id = org AND z.boundary_geojson IS NOT NULL;
$$;

-- The houses of one zone in one answer, for ordering the walk.
CREATE OR REPLACE FUNCTION public.zone_house_points(the_zone UUID)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_array(h.id, round(h.lng::numeric, 6), round(h.lat::numeric, 6), h.address)), '[]'::jsonb)
  FROM zone_houses zh JOIN houses h ON h.id = zh.house_id WHERE zh.zone_id = the_zone;
$$;

-- The street vertices of a zone's USPS route, back in degrees, for parking.
CREATE OR REPLACE FUNCTION public.zone_street_points(the_zone UUID)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_array(
    round(((s.seg[0])[0] / (cos(radians(39.5)) * 111320.0))::numeric, 6), round(((s.seg[0])[1] / 110574.0)::numeric, 6))), '[]'::jsonb)
  FROM hanger_zones z JOIN eddm_segments s ON s.route_id = z.eddm_route_id WHERE z.id = the_zone;
$$;

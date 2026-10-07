-- The last inch: no two zones share a square metre, and every house is in.
--
-- The cells are exact in theory; in practice a vertex rounds differently
-- in two zones' runs and leaves a sliver of a few square metres where they
-- meet. This pass takes the zones in a fixed order and subtracts from each
-- whatever an earlier one already holds, so any residue belongs to exactly
-- one of them. A house left outside its zone by such a residue is given a
-- small disk first, cut out of every other zone.
CREATE OR REPLACE FUNCTION public.zone_dedupe(org UUID)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE z RECORD; others geometry; mine geometry; disk geometry; trimmed INTEGER := 0; fixed INTEGER := 0; ring JSONB; pieces INTEGER;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS zd (id UUID, g geometry, done BOOLEAN) ON COMMIT DROP;
  TRUNCATE zd;
  INSERT INTO zd SELECT id, ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(boundary_geojson::text), 4326)), 3), false
  FROM hanger_zones WHERE organization_id = org AND boundary_geojson IS NOT NULL;
  CREATE INDEX IF NOT EXISTS zd_idx ON zd USING gist (g);

  FOR z IN
    SELECT zh.zone_id, house_geom(h.lng, h.lat) AS p
    FROM zone_houses zh JOIN houses h ON h.id = zh.house_id JOIN zd ON zd.id = zh.zone_id
    WHERE NOT ST_Intersects(zd.g, house_geom(h.lng, h.lat))
  LOOP
    disk := ST_Buffer(z.p::geography, 6)::geometry;
    UPDATE zd SET g = ST_CollectionExtract(ST_MakeValid(ST_Difference(g, disk)), 3) WHERE id <> z.zone_id AND g && disk;
    UPDATE zd SET g = ST_CollectionExtract(ST_MakeValid(ST_Union(g, disk)), 3) WHERE id = z.zone_id;
    fixed := fixed + 1;
  END LOOP;

  FOR z IN SELECT id FROM zd ORDER BY id LOOP
    SELECT g INTO mine FROM zd WHERE id = z.id;
    SELECT ST_Union(o.g) INTO others FROM zd o WHERE o.done AND o.g && mine AND ST_Intersects(o.g, mine);
    IF others IS NOT NULL THEN
      UPDATE zd SET g = ST_CollectionExtract(ST_MakeValid(ST_Difference(g, others)), 3) WHERE id = z.id;
      trimmed := trimmed + 1;
    END IF;
    UPDATE zd SET done = true WHERE id = z.id;
  END LOOP;

  FOR z IN SELECT id, g FROM zd LOOP
    pieces := ST_NumGeometries(z.g);
    IF pieces IS NULL OR pieces = 0 THEN CONTINUE; END IF;
    SELECT jsonb_agg(jsonb_build_object('lng', ST_X(p.geom), 'lat', ST_Y(p.geom)) ORDER BY p.path)
      INTO ring
    FROM ST_DumpPoints(ST_ExteriorRing(ST_GeometryN(z.g, (
      SELECT i FROM generate_series(1, pieces) i ORDER BY ST_Area(ST_GeometryN(z.g, i)) DESC LIMIT 1)))) p;
    UPDATE hanger_zones SET boundary = ring, geometry = jsonb_build_object('points', ring),
      boundary_geojson = ST_AsGeoJSON(z.g, 9)::jsonb, updated_at = now() WHERE id = z.id;
    UPDATE attractor_waves w SET geometry = jsonb_build_object('points', ring), updated_at = now()
    FROM eddm_routes r JOIN hanger_zones hz ON hz.eddm_route_id = r.id WHERE hz.id = z.id AND w.id = r.wave_id;
  END LOOP;
  RETURN jsonb_build_object('trimmed', trimmed, 'fixed', fixed);
END $$;

-- The same, for one zone as it is built: it gives up whatever an earlier
-- zone already holds, and takes its ground back from any later one. Run
-- after each outline, the county stays a partition whatever order the zones
-- are built in.
CREATE OR REPLACE FUNCTION public.zone_settle(the_zone UUID)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE org UUID; mine geometry; earlier geometry; o RECORD; ring JSONB; pieces INTEGER; fixed INTEGER := 0; z RECORD; disk geometry; trimmed_later INTEGER := 0;
BEGIN
  SELECT organization_id, ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(boundary_geojson::text), 4326)), 3)
    INTO org, mine FROM hanger_zones WHERE id = the_zone AND boundary_geojson IS NOT NULL;
  IF mine IS NULL THEN RETURN jsonb_build_object('settled', false); END IF;

  SELECT ST_Union(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(z2.boundary_geojson::text), 4326)), 3)) INTO earlier
  FROM hanger_zones z2 WHERE z2.organization_id = org AND z2.id < the_zone AND z2.boundary_geojson IS NOT NULL
    AND ST_SetSRID(ST_GeomFromGeoJSON(z2.boundary_geojson::text), 4326) && mine;
  IF earlier IS NOT NULL THEN
    mine := ST_CollectionExtract(ST_MakeValid(ST_Difference(mine, earlier)), 3);
  END IF;

  -- Any of my houses the trimming left outside get a small disk back, cut
  -- from whoever holds that ground.
  FOR z IN SELECT house_geom(h.lng, h.lat) AS p FROM zone_houses zh JOIN houses h ON h.id = zh.house_id
           WHERE zh.zone_id = the_zone AND NOT ST_Intersects(mine, house_geom(h.lng, h.lat)) LOOP
    disk := ST_Buffer(z.p::geography, 6)::geometry;
    mine := ST_CollectionExtract(ST_MakeValid(ST_Union(mine, disk)), 3);
    fixed := fixed + 1;
  END LOOP;

  FOR o IN SELECT z2.id, ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(z2.boundary_geojson::text), 4326)), 3) AS g
           FROM hanger_zones z2 WHERE z2.organization_id = org AND z2.id <> the_zone AND z2.boundary_geojson IS NOT NULL
             AND ST_SetSRID(ST_GeomFromGeoJSON(z2.boundary_geojson::text), 4326) && mine LOOP
    IF (o.id > the_zone OR fixed > 0) AND ST_Intersects(o.g, mine) THEN
      -- A later zone yields; an earlier one yields only the disks just added.
      UPDATE hanger_zones SET boundary_geojson = ST_AsGeoJSON(ST_CollectionExtract(ST_MakeValid(ST_Difference(o.g,
        CASE WHEN o.id > the_zone THEN mine ELSE ST_Intersection(o.g, mine) END)), 3), 9)::jsonb, updated_at = now()
      WHERE id = o.id;
      trimmed_later := trimmed_later + 1;
    END IF;
  END LOOP;

  pieces := ST_NumGeometries(mine);
  SELECT jsonb_agg(jsonb_build_object('lng', ST_X(p.geom), 'lat', ST_Y(p.geom)) ORDER BY p.path) INTO ring
  FROM ST_DumpPoints(ST_ExteriorRing(ST_GeometryN(mine, (
    SELECT i FROM generate_series(1, pieces) i ORDER BY ST_Area(ST_GeometryN(mine, i)) DESC LIMIT 1)))) p;
  UPDATE hanger_zones SET boundary = ring, geometry = jsonb_build_object('points', ring),
    boundary_geojson = ST_AsGeoJSON(mine, 9)::jsonb, updated_at = now() WHERE id = the_zone;
  UPDATE attractor_waves w SET geometry = jsonb_build_object('points', ring), updated_at = now()
  FROM eddm_routes r JOIN hanger_zones hz ON hz.eddm_route_id = r.id WHERE hz.id = the_zone AND w.id = r.wave_id;
  RETURN jsonb_build_object('settled', true, 'fixed', fixed, 'neighboursTrimmed', trimmed_later);
END $$;

-- The zones without their outlines, for a list.
CREATE OR REPLACE FUNCTION public.zones_list(org UUID)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', z.id, 'name', z.name, 'zip', z.zip, 'mode', z.mode, 'houses', z.house_count,
    'pathKm', z.path_km, 'minutes', z.est_minutes, 'gapM', z.median_gap_m,
    'park', z.park_point, 'start', z.start_point, 'startAddress', z.start_address,
    'routeId', r.route_id, 'walkability', r.walkability, 'reason', r.walkability_reason, 'waveId', r.wave_id,
    'clients', (SELECT count(*) FROM zone_houses zh JOIN property_events e ON e.house_id = zh.house_id
                WHERE zh.zone_id = z.id AND e.kind IN ('client', 'job_completed')),
    'builtAt', z.built_at
  ) ORDER BY z.zip, z.name), '[]'::jsonb)
  FROM hanger_zones z LEFT JOIN eddm_routes r ON r.id = z.eddm_route_id
  WHERE z.organization_id = org AND z.eddm_route_id IS NOT NULL AND z.house_count > 0;
$$;

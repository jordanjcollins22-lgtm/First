-- Every zone one piece.
--
-- After enclaves are handed over, a route can still be in two parts: a big
-- second piece with its own edges, between other zones. That is two walks,
-- so it becomes two zones: the second piece gets a zone and a wave of its
-- own, named "part 2". Pieces that touch no zone are outposts in empty
-- land and stay with their zone. Enclaves are now handed over when one
-- neighbour wraps half their edge, not seven tenths.
ALTER TABLE public.hanger_zones ADD COLUMN IF NOT EXISTS wave_id UUID REFERENCES public.attractor_waves(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.zone_split_pieces(org UUID, the_zip TEXT)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE z RECORD; p RECORD; main_idx INTEGER; n_pieces INTEGER; affected UUID[] := '{}'; made INTEGER := 0; new_id UUID; part INTEGER; wave UUID; touching BOOLEAN; moved INTEGER;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS zs_zones (id UUID, g geometry) ON COMMIT DROP;
  TRUNCATE zs_zones;
  INSERT INTO zs_zones SELECT id, ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(boundary_geojson::text), 4326)), 3)
  FROM hanger_zones WHERE organization_id = org AND boundary_geojson IS NOT NULL AND eddm_route_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS zs_zones_idx ON zs_zones USING gist (g);

  FOR z IN SELECT hz.id, hz.name, hz.route_id, hz.eddm_route_id, hz.zip, hz.position, zz.g
           FROM zs_zones zz JOIN hanger_zones hz ON hz.id = zz.id WHERE the_zip IS NULL OR hz.zip = the_zip LOOP
    n_pieces := ST_NumGeometries(z.g);
    IF n_pieces IS NULL OR n_pieces < 2 THEN CONTINUE; END IF;
    SELECT i INTO main_idx FROM generate_series(1, n_pieces) i
    ORDER BY (SELECT count(*) FROM zone_houses zh JOIN houses h ON h.id = zh.house_id
              WHERE zh.zone_id = z.id AND ST_Intersects(ST_GeometryN(z.g, i), house_geom(h.lng, h.lat))) DESC
    LIMIT 1;

    FOR p IN SELECT i, ST_GeometryN(z.g, i) AS piece FROM generate_series(1, n_pieces) i WHERE i <> main_idx LOOP
      SELECT EXISTS (SELECT 1 FROM zs_zones o WHERE o.id <> z.id AND o.g && ST_Expand(p.piece, 0.0003) AND ST_DWithin(o.g, p.piece, 0.00003)) INTO touching;
      IF NOT touching THEN CONTINUE; END IF;
      IF NOT EXISTS (SELECT 1 FROM zone_houses zh JOIN houses h ON h.id = zh.house_id
                     WHERE zh.zone_id = z.id AND ST_Intersects(p.piece, house_geom(h.lng, h.lat))) THEN CONTINUE; END IF;

      SELECT count(*) + 1 INTO part FROM hanger_zones WHERE eddm_route_id = z.eddm_route_id;
      INSERT INTO hanger_zones (organization_id, route_id, name, geometry_type, geometry, position, eddm_route_id, zip)
      VALUES (org, z.route_id, regexp_replace(z.name, ' part \d+$', '') || ' part ' || part, 'polygon', '{"points":[]}'::jsonb, z.position, z.eddm_route_id, z.zip)
      RETURNING id INTO new_id;
      UPDATE zone_houses zh SET zone_id = new_id
      FROM houses h WHERE zh.house_id = h.id AND zh.zone_id = z.id AND ST_Intersects(p.piece, house_geom(h.lng, h.lat));
      GET DIAGNOSTICS moved = ROW_COUNT;
      INSERT INTO attractor_waves (organization_id, type_id, name, geometry_type, geometry, status, notes)
      VALUES (org, 'door_hangers', 'USPS ' || regexp_replace(z.name, ' part \d+$', '') || ' part ' || part, 'polygon', '{"points":[]}'::jsonb, 'planned',
              'Zone ' || regexp_replace(z.name, ' part \d+$', '') || ' part ' || part || ': ' || moved || ' houses, a separate part of the route.')
      RETURNING id INTO wave;
      UPDATE hanger_zones SET wave_id = wave, house_count = moved WHERE id = new_id;
      made := made + 1;
      affected := affected || z.id || new_id;
    END LOOP;
  END LOOP;
  UPDATE hanger_zones SET house_count = (SELECT count(*) FROM zone_houses WHERE zone_id = hanger_zones.id), updated_at = now() WHERE id = ANY (affected);
  RETURN jsonb_build_object('made', made, 'affected', coalesce((SELECT jsonb_agg(DISTINCT a) FROM unnest(affected) a), '[]'::jsonb));
END $$;

-- Enclaves hand over at half their edge wrapped; houses move with their
-- zone but keep their USPS route. A rebuild removes last time's split
-- parts (and their waves) unless somebody has walked them. Waves follow
-- the zone's own wave first, the route's otherwise, everywhere a zone's
-- wave is looked up: outline, settle, the map's layer and list, and the
-- house card, which now finds the zone through the house's membership.
-- (The bodies are those in 0177/0175/0173/0176 with those changes; see
-- the live definitions.)

-- A zone that ends up under a hundred doors is merged into the
-- neighbour it shares the most border with, or the nearest zone within
-- 250 m when nothing touches it. A split part that empties
-- goes, with its wave; a route's own zone stays, empty, keeping its place.
CREATE OR REPLACE FUNCTION public.zone_merge_small(org UUID, the_zip TEXT, max_houses INTEGER DEFAULT 100)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE z RECORD; nb RECORD; merged INTEGER := 0; affected UUID[] := '{}'; moved INTEGER; live INTEGER;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS zm_zones (id UUID, g geometry, houses INTEGER, is_part BOOLEAN) ON COMMIT DROP;
  TRUNCATE zm_zones;
  INSERT INTO zm_zones
  SELECT hz.id, ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(hz.boundary_geojson::text), 4326)), 3), hz.house_count, hz.wave_id IS NOT NULL
  FROM hanger_zones hz WHERE hz.organization_id = org AND hz.boundary_geojson IS NOT NULL AND hz.eddm_route_id IS NOT NULL AND hz.house_count > 0;
  CREATE INDEX IF NOT EXISTS zm_zones_idx ON zm_zones USING gist (g);

  FOR z IN SELECT zz.* FROM zm_zones zz JOIN hanger_zones hz ON hz.id = zz.id
           WHERE (the_zip IS NULL OR hz.zip = the_zip) AND zz.houses <= max_houses ORDER BY zz.houses LOOP
    SELECT count(*) INTO live FROM zone_houses WHERE zone_id = z.id;
    IF live = 0 THEN CONTINUE; END IF;
    SELECT n.id, ST_Length(ST_Intersection(ST_Boundary(z.g), ST_Buffer(n.g, 0.00003))::geography) AS shared INTO nb
    FROM zm_zones n
    WHERE n.id <> z.id AND n.g && ST_Expand(z.g, 0.0003) AND ST_DWithin(n.g, z.g, 0.00003)
      AND (SELECT count(*) FROM zone_houses WHERE zone_id = n.id) > 0
    ORDER BY 2 DESC LIMIT 1;
    IF nb.id IS NULL OR coalesce(nb.shared, 0) <= 0 THEN
      -- Nothing touches it: the nearest zone within a short walk takes it.
      SELECT n.id, 0::double precision AS shared INTO nb
      FROM zm_zones n
      WHERE n.id <> z.id AND n.g && ST_Expand(z.g, 0.003) AND ST_DWithin(n.g::geography, z.g::geography, 250)
        AND (SELECT count(*) FROM zone_houses WHERE zone_id = n.id) > 0
      ORDER BY ST_Distance(n.g::geography, z.g::geography), n.houses DESC LIMIT 1;
      IF nb.id IS NULL THEN CONTINUE; END IF;
    END IF;

    UPDATE zone_houses SET zone_id = nb.id WHERE zone_id = z.id;
    GET DIAGNOSTICS moved = ROW_COUNT;
    IF z.is_part AND NOT EXISTS (SELECT 1 FROM door_hanger_events e WHERE e.zone_id = z.id) THEN
      DELETE FROM attractor_waves w USING hanger_zones hz WHERE hz.id = z.id AND hz.wave_id = w.id;
      DELETE FROM hanger_zones WHERE id = z.id;
    ELSE
      UPDATE hanger_zones SET house_count = 0, boundary = NULL, boundary_geojson = NULL, walk_path = NULL, mode = NULL, path_km = NULL, est_minutes = NULL, updated_at = now() WHERE id = z.id;
    END IF;
    merged := merged + 1;
    affected := affected || nb.id;
  END LOOP;
  UPDATE hanger_zones SET house_count = (SELECT count(*) FROM zone_houses WHERE zone_id = hanger_zones.id), updated_at = now() WHERE id = ANY (affected);
  RETURN jsonb_build_object('merged', merged, 'affected', coalesce((SELECT jsonb_agg(DISTINCT a) FROM unnest(affected) a), '[]'::jsonb));
END $$;

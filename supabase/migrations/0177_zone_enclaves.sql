-- No zone inside another zone.
--
-- A house whose nearest USPS street belongs to a different route than its
-- neighbours' becomes an island of that route's zone inside the zone around
-- it: three doors of C019 in the middle of C030, drawn as their own little
-- zone. A zone is one walk, so an island belongs to whoever surrounds it.
-- For every zone, every piece but the one with the most doors is handed
-- to the neighbouring zone that shares the longest border with it when it
-- is small -- ten doors, or a twentieth of the zone, whichever is more --
-- or when that neighbour wraps most of its edge, which is a piece inside
-- another zone whatever its size. A big second piece with its own edges
-- is a route in two parts and stays; a piece that touches no zone at all
-- is a real outpost in empty land and stays. The affected zones are then
-- rebuilt and settled by the caller.
CREATE OR REPLACE FUNCTION public.zone_absorb_enclaves(org UUID, the_zip TEXT)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  z RECORD; p RECORD; nb RECORD; moved INTEGER := 0; affected UUID[] := '{}'; n_pieces INTEGER; piece_houses INTEGER; islands INTEGER := 0; kept_big INTEGER := 0; zone_total INTEGER; limit_houses INTEGER; main_idx INTEGER; perimeter DOUBLE PRECISION; enclosed BOOLEAN;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS ze_zones (id UUID, route_id UUID, g geometry) ON COMMIT DROP;
  TRUNCATE ze_zones;
  INSERT INTO ze_zones
  SELECT id, eddm_route_id, ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(boundary_geojson::text), 4326)), 3)
  FROM hanger_zones WHERE organization_id = org AND boundary_geojson IS NOT NULL AND eddm_route_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS ze_zones_idx ON ze_zones USING gist (g);

  FOR z IN SELECT zz.id, zz.route_id, zz.g FROM ze_zones zz JOIN hanger_zones hz ON hz.id = zz.id
           WHERE the_zip IS NULL OR hz.zip = the_zip LOOP
    n_pieces := ST_NumGeometries(z.g);
    IF n_pieces IS NULL OR n_pieces < 2 THEN CONTINUE; END IF;
    SELECT count(*) INTO zone_total FROM zone_houses WHERE zone_id = z.id;
    limit_houses := greatest(10, zone_total / 20);
    -- The piece with the most doors is the zone; it is never given away.
    SELECT i INTO main_idx FROM generate_series(1, n_pieces) i
    ORDER BY (SELECT count(*) FROM zone_houses zh JOIN houses h ON h.id = zh.house_id
              WHERE zh.zone_id = z.id AND ST_Intersects(ST_GeometryN(z.g, i), house_geom(h.lng, h.lat))) DESC
    LIMIT 1;

    FOR p IN
      SELECT i, ST_GeometryN(z.g, i) AS piece,
             (SELECT count(*) FROM zone_houses zh JOIN houses h ON h.id = zh.house_id
              WHERE zh.zone_id = z.id AND ST_Intersects(ST_GeometryN(z.g, i), house_geom(h.lng, h.lat))) AS houses
      FROM generate_series(1, n_pieces) i WHERE i <> main_idx
    LOOP
      IF p.houses = 0 THEN CONTINUE; END IF;
      -- The neighbour with the longest shared border, if any touches.
      SELECT n.id, n.route_id,
             ST_Length(ST_Intersection(ST_Boundary(p.piece), ST_Buffer(n.g, 0.00003))::geography) AS shared
        INTO nb
      FROM ze_zones n
      WHERE n.id <> z.id AND n.g && ST_Expand(p.piece, 0.0003) AND ST_DWithin(n.g, p.piece, 0.00003)
      ORDER BY 3 DESC
      LIMIT 1;
      IF nb.id IS NULL OR coalesce(nb.shared, 0) <= 0 THEN
        islands := islands + 1;
        CONTINUE;
      END IF;
      -- Given away when it is small, or when one neighbour wraps most of
      -- it: a piece inside another zone is that zone's, whatever its size.
      perimeter := ST_Perimeter(p.piece::geography);
      enclosed := perimeter > 0 AND nb.shared / perimeter >= 0.7;
      IF p.houses > limit_houses AND NOT enclosed THEN kept_big := kept_big + 1; CONTINUE; END IF;

      UPDATE houses h SET eddm_route_id = nb.route_id
      FROM zone_houses zh WHERE zh.house_id = h.id AND zh.zone_id = z.id AND ST_Intersects(p.piece, house_geom(h.lng, h.lat));
      GET DIAGNOSTICS piece_houses = ROW_COUNT;
      UPDATE zone_houses zh SET zone_id = nb.id
      FROM houses h WHERE zh.house_id = h.id AND zh.zone_id = z.id AND ST_Intersects(p.piece, house_geom(h.lng, h.lat));
      moved := moved + piece_houses;
      affected := affected || z.id || nb.id;
    END LOOP;
  END LOOP;

  UPDATE hanger_zones SET house_count = (SELECT count(*) FROM zone_houses WHERE zone_id = hanger_zones.id), updated_at = now()
  WHERE id = ANY (affected);
  UPDATE eddm_routes r SET house_count = (SELECT count(*) FROM houses h WHERE h.eddm_route_id = r.id)
  WHERE r.id IN (SELECT eddm_route_id FROM hanger_zones WHERE id = ANY (affected));

  RETURN jsonb_build_object('moved', moved, 'islandsKept', islands, 'bigPiecesKept', kept_big,
    'affected', coalesce((SELECT jsonb_agg(DISTINCT a) FROM unnest(affected) a), '[]'::jsonb));
END $$;

-- How many zones still have a piece inside another zone: the check.
CREATE OR REPLACE FUNCTION public.zone_enclave_count(org UUID)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE z RECORD; n_pieces INTEGER; touching INTEGER := 0; islands INTEGER := 0; zones_multi INTEGER := 0; p RECORD; hit BOOLEAN;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS zc_zones (id UUID, g geometry) ON COMMIT DROP;
  TRUNCATE zc_zones;
  INSERT INTO zc_zones SELECT id, ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(boundary_geojson::text), 4326)), 3)
  FROM hanger_zones WHERE organization_id = org AND boundary_geojson IS NOT NULL AND eddm_route_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS zc_zones_idx ON zc_zones USING gist (g);
  FOR z IN SELECT id, g FROM zc_zones LOOP
    n_pieces := ST_NumGeometries(z.g);
    IF n_pieces IS NULL OR n_pieces < 2 THEN CONTINUE; END IF;
    zones_multi := zones_multi + 1;
    FOR p IN SELECT ST_GeometryN(z.g, i) AS piece FROM generate_series(1, n_pieces) i LOOP
      SELECT EXISTS (SELECT 1 FROM zc_zones n WHERE n.id <> z.id AND ST_DWithin(n.g, p.piece, 0.00003)) INTO hit;
      IF hit THEN touching := touching + 1; ELSE islands := islands + 1; END IF;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('zonesInPieces', zones_multi, 'piecesTouchingAnotherZone', touching, 'piecesInEmptyLand', islands);
END $$;

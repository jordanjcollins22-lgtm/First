-- House-to-route assignment in parts, inside the API's statement timeout.
--
-- The first version looked up the nearest street twice per house and did a
-- whole ZIP in one statement; Bel Air's eighteen thousand houses took twenty
-- seconds and the API cut it off at eight. Now one lateral lookup per house,
-- and the ZIP's houses split by a hash of their id into `parts`, each call
-- doing one part. The last part writes the counts. (The reach and the
-- search box were widened in 0170.)
DROP FUNCTION IF EXISTS eddm_assign_houses(UUID, TEXT, DOUBLE PRECISION);

CREATE OR REPLACE FUNCTION eddm_assign_houses(
  org UUID, the_zip TEXT, max_m DOUBLE PRECISION DEFAULT 90, part INTEGER DEFAULT 0, parts INTEGER DEFAULT 1
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE assigned INTEGER; unserved INTEGER;
BEGIN
  UPDATE houses h SET
    eddm_route_id = CASE WHEN n.dist IS NOT NULL AND n.dist <= max_m THEN n.route_id ELSE NULL END,
    eddm_route_distance_m = n.dist,
    eddm_unserved = (n.dist IS NULL OR n.dist > max_m)
  FROM (
    SELECT c.id AS house_id, s.route_id, s.dist
    FROM (
      SELECT h2.id,
             eddm_to_metres(h2.lng::double precision, h2.lat::double precision) AS p,
             box(eddm_to_metres(h2.lng::double precision - 0.0015, h2.lat::double precision - 0.0012),
                 eddm_to_metres(h2.lng::double precision + 0.0015, h2.lat::double precision + 0.0012)) AS b
      FROM houses h2
      WHERE h2.organization_id = org AND h2.kind = 'house' AND NOT h2.needs_review
        AND NOT (h2.lat = 0 AND h2.lng = 0)
        AND right(h2.normalized_address, 5) = the_zip
        AND ((hashtext(h2.id::text) % parts) + parts) % parts = part
    ) c
    LEFT JOIN LATERAL (
      SELECT s.route_id, s.seg <-> c.p AS dist
      FROM eddm_segments s
      WHERE s.organization_id = org AND s.bbox && c.b
      ORDER BY s.seg <-> c.p
      LIMIT 1
    ) s ON true
  ) n
  WHERE n.house_id = h.id;

  IF part < parts - 1 THEN
    RETURN jsonb_build_object('part', part, 'parts', parts);
  END IF;

  SELECT count(*) FILTER (WHERE eddm_route_id IS NOT NULL), count(*) FILTER (WHERE eddm_unserved)
    INTO assigned, unserved
  FROM houses h WHERE h.organization_id = org AND h.kind = 'house' AND NOT h.needs_review
    AND right(h.normalized_address, 5) = the_zip;

  UPDATE eddm_routes r SET house_count = (SELECT count(*) FROM houses h WHERE h.eddm_route_id = r.id)
  WHERE r.organization_id = org AND r.zip = the_zip;

  RETURN jsonb_build_object('assigned', assigned, 'unserved', unserved, 'part', part, 'parts', parts);
END $$;

-- Each part scans the ZIP's houses; by ZIP is an index walk, not a pass
-- over the county.
CREATE INDEX IF NOT EXISTS houses_zip_idx ON houses (organization_id, right(normalized_address, 5));

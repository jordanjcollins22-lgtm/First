-- Reach of a route's street: a hundred and fifty metres.
--
-- At ninety, the first build left two thousand houses in Bel Air alone
-- "unreached", and most of them were ninety to a hundred and fifty metres
-- from the street: a deep lot, a long driveway, a flag lot behind another.
-- Those doors are on the walk. The houses no route serves at all are the
-- ones with no street within a couple of hundred metres, which the wider
-- search box now measures instead of giving up on.
CREATE OR REPLACE FUNCTION eddm_assign_houses(
  org UUID, the_zip TEXT, max_m DOUBLE PRECISION DEFAULT 150, part INTEGER DEFAULT 0, parts INTEGER DEFAULT 1
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
             box(eddm_to_metres(h2.lng::double precision - 0.0025, h2.lat::double precision - 0.002),
                 eddm_to_metres(h2.lng::double precision + 0.0025, h2.lat::double precision + 0.002)) AS b
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

-- Counting the houses in a shape, off the spatial index.
--
-- The count behind drawing a wave and clicking a USPS route read every
-- house in the county, tested each against the polygon, and took five
-- seconds for a box round one street, which is longer than the API
-- allows a statement, so the screen said it could not count. The houses
-- already have a spatial index; this asks it. A ZIP list is a separate
-- branch on its own index rather than an OR that defeats both.
CREATE OR REPLACE FUNCTION public.houses_in_shape(org UUID, ring JSONB, zips JSONB)
RETURNS TABLE (id UUID, address TEXT, lat DOUBLE PRECISION, lng DOUBLE PRECISION, rank INTEGER, hangs INTEGER, dnc BOOLEAN)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH shape AS (
    SELECT
      CASE WHEN ring IS NOT NULL AND jsonb_typeof(ring) = 'array' AND jsonb_array_length(ring) >= 3
        THEN ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(jsonb_build_object(
               'type', 'Polygon', 'coordinates', jsonb_build_array(ring || jsonb_build_array(ring->0)))::text), 4326))
        ELSE NULL END AS poly,
      CASE WHEN zips IS NOT NULL AND jsonb_typeof(zips) = 'array'
        THEN (SELECT array_agg(left(z, 5)) FROM jsonb_array_elements_text(zips) z) ELSE NULL END AS zip_list
  ),
  picked AS (
    SELECT h.id, h.address, h.lat::double precision AS lat, h.lng::double precision AS lng
    FROM houses h, shape s
    WHERE s.poly IS NOT NULL
      AND h.organization_id = org AND h.kind = 'house' AND NOT h.needs_review AND NOT (h.lat = 0 AND h.lng = 0)
      AND house_geom(h.lng, h.lat) && s.poly
      AND ST_Intersects(s.poly, house_geom(h.lng, h.lat))
    UNION
    SELECT h.id, h.address, h.lat::double precision, h.lng::double precision
    FROM houses h, shape s
    WHERE s.zip_list IS NOT NULL
      AND h.organization_id = org AND h.kind = 'house' AND NOT h.needs_review AND NOT (h.lat = 0 AND h.lng = 0)
      AND right(h.normalized_address, 5) = ANY (s.zip_list)
  ),
  ranks AS (
    SELECT e.house_id,
           max(CASE e.kind WHEN 'spoken_to' THEN 1 WHEN 'evaluation' THEN 2 WHEN 'proposal' THEN 3
                           WHEN 'client' THEN 4 WHEN 'job_completed' THEN 5 ELSE 0 END) AS rank
    FROM property_events e WHERE e.house_id IN (SELECT p.id FROM picked p) GROUP BY e.house_id
  ),
  known AS (SELECT DISTINCT c.house_id FROM house_contacts c WHERE c.house_id IN (SELECT p.id FROM picked p)),
  hangs AS (SELECT d.house_id, count(*)::int AS n FROM door_hanger_events d WHERE d.house_id IN (SELECT p.id FROM picked p) GROUP BY d.house_id),
  dnc AS (
    SELECT DISTINCT hc.house_id FROM house_contacts hc JOIN customers c ON c.id = hc.customer_id
    WHERE c.do_not_contact AND hc.house_id IN (SELECT p.id FROM picked p)
  )
  SELECT p.id, p.address, p.lat, p.lng,
         greatest(coalesce(r.rank, 0), CASE WHEN k.house_id IS NOT NULL THEN 1 ELSE 0 END)::int AS rank,
         coalesce(g.n, 0) AS hangs,
         (d.house_id IS NOT NULL) AS dnc
  FROM picked p
  LEFT JOIN ranks r ON r.house_id = p.id
  LEFT JOIN known k ON k.house_id = p.id
  LEFT JOIN hangs g ON g.house_id = p.id
  LEFT JOIN dnc d ON d.house_id = p.id;
$$;

-- How many doors are inside a shape somebody has drawn, from the county's
-- houses rather than our own address book.
--
-- Door hangers are ordered and carried in boxes, and "how many doors is that"
-- decides both. Until the county was imported the app could only count the
-- addresses it happened to hold, which was a fraction of any street. Now every
-- house is here, so the count is the count. Done in the database because the
-- shape is small and the houses are a hundred and seventeen thousand; the
-- bounding box narrows it through the lat/lng index and the polygon test does
-- the rest. Along with the count comes what the walk needs: how far each door
-- has got with us, who has asked not to be contacted, and how many hangers
-- each door has already had, which decides the design it gets next.

CREATE OR REPLACE FUNCTION houses_in_shape(org UUID, ring JSONB, zips JSONB)
RETURNS TABLE (id UUID, address TEXT, lat DOUBLE PRECISION, lng DOUBLE PRECISION, rank INTEGER, hangs INTEGER, dnc BOOLEAN)
LANGUAGE sql
STABLE
AS $$
  WITH shape AS (
    SELECT
      CASE WHEN ring IS NOT NULL AND jsonb_typeof(ring) = 'array' AND jsonb_array_length(ring) >= 3
        THEN ('(' || (SELECT string_agg('(' || (p->>0) || ',' || (p->>1) || ')', ',') FROM jsonb_array_elements(ring) p) || ')')::polygon
        ELSE NULL END AS poly,
      (SELECT min((p->>1)::double precision) FROM jsonb_array_elements(ring) p) AS min_lat,
      (SELECT max((p->>1)::double precision) FROM jsonb_array_elements(ring) p) AS max_lat,
      (SELECT min((p->>0)::double precision) FROM jsonb_array_elements(ring) p) AS min_lng,
      (SELECT max((p->>0)::double precision) FROM jsonb_array_elements(ring) p) AS max_lng,
      CASE WHEN zips IS NOT NULL AND jsonb_typeof(zips) = 'array'
        THEN (SELECT array_agg(left(z, 5)) FROM jsonb_array_elements_text(zips) z) ELSE NULL END AS zip_list
  ),
  picked AS (
    SELECT h.id, h.address, h.lat::double precision AS lat, h.lng::double precision AS lng
    FROM houses h, shape s
    WHERE h.organization_id = org
      AND h.kind = 'house' AND NOT h.needs_review AND NOT (h.lat = 0 AND h.lng = 0)
      AND (
        (s.poly IS NOT NULL
          AND h.lat BETWEEN s.min_lat AND s.max_lat AND h.lng BETWEEN s.min_lng AND s.max_lng
          AND s.poly @> point(h.lng::double precision, h.lat::double precision))
        OR (s.zip_list IS NOT NULL AND right(h.normalized_address, 5) = ANY (s.zip_list))
      )
  ),
  ranks AS (
    SELECT e.house_id,
           max(CASE e.kind WHEN 'spoken_to' THEN 1 WHEN 'evaluation' THEN 2 WHEN 'proposal' THEN 3
                           WHEN 'client' THEN 4 WHEN 'job_completed' THEN 5 ELSE 0 END) AS rank
    FROM property_events e WHERE e.house_id IN (SELECT id FROM picked) GROUP BY e.house_id
  ),
  known AS (SELECT DISTINCT c.house_id FROM house_contacts c WHERE c.house_id IN (SELECT id FROM picked)),
  hangs AS (SELECT d.house_id, count(*)::int AS n FROM door_hanger_events d WHERE d.house_id IN (SELECT id FROM picked) GROUP BY d.house_id),
  dnc AS (
    SELECT DISTINCT hc.house_id FROM house_contacts hc JOIN customers c ON c.id = hc.customer_id
    WHERE c.do_not_contact AND hc.house_id IN (SELECT id FROM picked)
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

-- The numbers for the panel: the count, who is what, and the print run by
-- design. One JSON value so no row cap applies.
CREATE OR REPLACE FUNCTION houses_coverage(org UUID, ring JSONB, zips JSONB, designs INTEGER DEFAULT 1)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH rows AS (SELECT * FROM houses_in_shape(org, ring, zips)),
  run AS (
    SELECT least(hangs + 1, greatest(1, designs)) AS design, count(*)::int AS n
    FROM rows WHERE NOT dnc GROUP BY 1
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM rows),
    'by_stage', jsonb_build_object(
      'untouched', (SELECT count(*) FROM rows WHERE rank = 0),
      'spoken_to', (SELECT count(*) FROM rows WHERE rank = 1),
      'evaluation', (SELECT count(*) FROM rows WHERE rank = 2),
      'proposal', (SELECT count(*) FROM rows WHERE rank = 3),
      'client', (SELECT count(*) FROM rows WHERE rank = 4),
      'job_completed', (SELECT count(*) FROM rows WHERE rank = 5)
    ),
    'do_not_contact', (SELECT count(*) FROM rows WHERE dnc),
    'to_hang', (SELECT count(*) FROM rows WHERE NOT dnc),
    'first_time', (SELECT count(*) FROM rows WHERE NOT dnc AND hangs = 0),
    'print_run', (SELECT coalesce(jsonb_agg(jsonb_build_object('design', design, 'count', n) ORDER BY design), '[]'::jsonb) FROM run)
  );
$$;

-- The doors themselves, for the sheet the walker carries.
CREATE OR REPLACE FUNCTION houses_door_list(org UUID, ring JSONB, zips JSONB, designs INTEGER DEFAULT 1, max_rows INTEGER DEFAULT 20000)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_array(r.id, r.address, r.rank, r.hangs, r.dnc, least(r.hangs + 1, greatest(1, designs)), r.lat, r.lng) ORDER BY r.address), '[]'::jsonb)
  FROM (SELECT * FROM houses_in_shape(org, ring, zips) LIMIT max_rows) r;
$$;

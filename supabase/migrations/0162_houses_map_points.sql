-- Every house on the map, in one answer.
--
-- The viewport-by-viewport fetch was fiddly to use and quietly capped: the
-- API returns at most a thousand rows of a set, so a busy viewport was a
-- sample without saying so. Instead the map asks once for every house as a
-- bare point -- longitude, latitude, and how far it has got with us, ranked
-- 0 to 5 -- in a single JSON value, which no row cap applies to, and does
-- its own clustering and colouring from there. A hundred and seventeen
-- thousand points is a few megabytes compressed, fetched once and cached.
--
-- A house with somebody attached but nothing recorded ranks as spoken to:
-- we know them, and the map's question is whether we do.
CREATE OR REPLACE FUNCTION houses_map_points(org UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH ranks AS (
    SELECT e.house_id,
           max(CASE e.kind
                 WHEN 'spoken_to' THEN 1
                 WHEN 'evaluation' THEN 2
                 WHEN 'proposal' THEN 3
                 WHEN 'client' THEN 4
                 WHEN 'job_completed' THEN 5
                 ELSE 0 END) AS rank
    FROM property_events e
    WHERE e.organization_id = org
    GROUP BY e.house_id
  ),
  known AS (
    SELECT DISTINCT c.house_id FROM house_contacts c
  )
  SELECT coalesce(jsonb_agg(jsonb_build_array(
           round(h.lng::numeric, 6), round(h.lat::numeric, 6),
           greatest(coalesce(r.rank, 0), CASE WHEN k.house_id IS NOT NULL THEN 1 ELSE 0 END)
         )), '[]'::jsonb)
  FROM houses h
  LEFT JOIN ranks r ON r.house_id = h.id
  LEFT JOIN known k ON k.house_id = h.id
  WHERE h.organization_id = org
    AND h.kind = 'house' AND NOT h.needs_review
    AND NOT (h.lat = 0 AND h.lng = 0);
$$;

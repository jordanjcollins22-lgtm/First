-- The houses no USPS route's streets come near, as bare points for the map.
--
-- One answer for the whole county rather than a page at a time: a few
-- thousand [lng, lat] pairs is a small body, and the map wants them all at
-- once to draw them. Sits beside eddm_unserved_cells (0167), which groups
-- the same houses for the list.
CREATE OR REPLACE FUNCTION houses_unserved_points(org UUID)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_array(
    round(h.lng::numeric, 6), round(h.lat::numeric, 6), h.id, h.address
  )), '[]'::jsonb)
  FROM houses h
  WHERE h.organization_id = org AND h.eddm_unserved AND h.kind = 'house' AND NOT h.needs_review
    AND NOT (h.lat = 0 AND h.lng = 0);
$$;

-- How many houses each ZIP holds, so a countywide build knows which ZIPs to
-- ask USPS about and in what order (biggest first: the most doors soonest).
CREATE OR REPLACE FUNCTION houses_zip_counts(org UUID)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('zip', zip, 'n', n) ORDER BY n DESC), '[]'::jsonb)
  FROM (
    SELECT right(h.normalized_address, 5) AS zip, count(*) AS n
    FROM houses h
    WHERE h.organization_id = org AND h.kind = 'house' AND NOT h.needs_review
      AND NOT (h.lat = 0 AND h.lng = 0)
    GROUP BY 1
  ) z
  WHERE zip ~ '^[0-9]{5}$';
$$;

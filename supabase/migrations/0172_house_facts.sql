-- Everything we know about one house, in one answer.
--
-- Clicking a dot on the map should say it all: where we stand with the
-- people there and who they are, whether the owner lives there and when it
-- last sold, which USPS route walks past it and whether that route is a
-- wave, how many hangers it has had. Six tables, one round trip.
CREATE OR REPLACE FUNCTION house_facts(org UUID, the_house UUID)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', h.id,
    'address', h.address,
    'lat', h.lat, 'lng', h.lng,
    'countyPin', h.source = 'harford_gis',
    'stageRank', greatest(
      coalesce((SELECT max(CASE e.kind WHEN 'spoken_to' THEN 1 WHEN 'evaluation' THEN 2 WHEN 'proposal' THEN 3 WHEN 'client' THEN 4 WHEN 'job_completed' THEN 5 ELSE 0 END)
                FROM property_events e WHERE e.house_id = h.id), 0),
      CASE WHEN EXISTS (SELECT 1 FROM house_contacts hc WHERE hc.house_id = h.id) THEN 1 ELSE 0 END),
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', e.kind, 'at', e.occurred_at, 'amountCents', e.amount_cents, 'note', e.note) ORDER BY e.occurred_at DESC)
                        FROM (SELECT * FROM property_events e WHERE e.house_id = h.id ORDER BY e.occurred_at DESC LIMIT 8) e), '[]'::jsonb),
    'contacts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'role', hc.role, 'doNotContact', c.do_not_contact))
                          FROM house_contacts hc JOIN customers c ON c.id = hc.customer_id WHERE hc.house_id = h.id), '[]'::jsonb),
    'ownership', (SELECT jsonb_build_object(
                    'ownerOccupied', o.owner_occupied, 'reason', o.occupancy_reason, 'ownerName', o.owner_name,
                    'lastSaleDate', o.last_sale_date, 'lastSalePrice', o.last_sale_price, 'yearBuilt', o.year_built,
                    'landUse', o.land_use, 'assessedValue', o.assessed_value, 'accountId', o.account_id, 'fetchedAt', o.fetched_at)
                  FROM house_ownership o WHERE o.house_id = h.id),
    'route', (SELECT jsonb_build_object(
                'zip', r.zip, 'routeId', r.route_id, 'walkability', r.walkability, 'reason', r.walkability_reason,
                'distanceM', round(h.eddm_route_distance_m::numeric), 'houseCount', r.house_count,
                'waveId', r.wave_id, 'waveName', w.name, 'waveStatus', w.status, 'zoneId', r.zone_id, 'zoneName', z.name)
              FROM eddm_routes r LEFT JOIN attractor_waves w ON w.id = r.wave_id LEFT JOIN hanger_zones z ON z.id = r.zone_id
              WHERE r.id = h.eddm_route_id),
    'unserved', h.eddm_unserved,
    'hangers', jsonb_build_object(
      'count', (SELECT count(*) FROM door_hanger_events d WHERE d.house_id = h.id),
      'last', (SELECT max(d.hung_at) FROM door_hanger_events d WHERE d.house_id = h.id),
      'designs', coalesce((SELECT jsonb_agg(DISTINCT d.design_number) FROM door_hanger_events d WHERE d.house_id = h.id), '[]'::jsonb))
  )
  FROM houses h WHERE h.id = the_house AND h.organization_id = org;
$$;

-- The house nearest a point, within about fifteen metres: the one that was clicked.
CREATE OR REPLACE FUNCTION house_nearest(org UUID, at_lat DOUBLE PRECISION, at_lng DOUBLE PRECISION)
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT h.id FROM houses h
  WHERE h.organization_id = org AND h.kind = 'house' AND NOT h.needs_review
    AND h.lat BETWEEN at_lat - 0.00015 AND at_lat + 0.00015
    AND h.lng BETWEEN at_lng - 0.0002 AND at_lng + 0.0002
  ORDER BY (h.lat - at_lat)^2 + ((h.lng - at_lng) * 0.77)^2
  LIMIT 1;
$$;

-- Where we stand, against who owns it: how many clients rent, how many of
-- the people we have spoken to own their house, and so on. Rows of
-- [stageRank, ownership, walkableRoute, count], ownership 0 unknown,
-- 1 owner-occupied, 2 absentee; walkableRoute 1 when the house is on a
-- route that became a wave.
CREATE OR REPLACE FUNCTION relationship_ownership_matrix(org UUID)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  WITH ranks AS (
    SELECT e.house_id, max(CASE e.kind WHEN 'spoken_to' THEN 1 WHEN 'evaluation' THEN 2 WHEN 'proposal' THEN 3 WHEN 'client' THEN 4 WHEN 'job_completed' THEN 5 ELSE 0 END) AS rank
    FROM property_events e WHERE e.organization_id = org GROUP BY e.house_id),
  known AS (SELECT DISTINCT c.house_id FROM house_contacts c)
  SELECT coalesce(jsonb_agg(jsonb_build_array(rank, own, walk, n)), '[]'::jsonb)
  FROM (
    SELECT greatest(coalesce(r.rank, 0), CASE WHEN k.house_id IS NOT NULL THEN 1 ELSE 0 END) AS rank,
           CASE o.owner_occupied WHEN true THEN 1 WHEN false THEN 2 ELSE 0 END AS own,
           CASE WHEN rt.walkability = 'walkable' THEN 1 ELSE 0 END AS walk,
           count(*) AS n
    FROM houses h
    LEFT JOIN ranks r ON r.house_id = h.id
    LEFT JOIN known k ON k.house_id = h.id
    LEFT JOIN house_ownership o ON o.house_id = h.id
    LEFT JOIN eddm_routes rt ON rt.id = h.eddm_route_id
    WHERE h.organization_id = org AND h.kind = 'house' AND NOT h.needs_review
    GROUP BY 1, 2, 3
  ) m;
$$;

-- The map's points carry the route too:
-- [lng, lat, stageRank, ownership, soldRecently, walkableRoute].
CREATE OR REPLACE FUNCTION houses_map_points(org UUID)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  WITH ranks AS (
    SELECT e.house_id,
           max(CASE e.kind WHEN 'spoken_to' THEN 1 WHEN 'evaluation' THEN 2 WHEN 'proposal' THEN 3
                           WHEN 'client' THEN 4 WHEN 'job_completed' THEN 5 ELSE 0 END) AS rank
    FROM property_events e WHERE e.organization_id = org GROUP BY e.house_id
  ),
  known AS (SELECT DISTINCT c.house_id FROM house_contacts c)
  SELECT coalesce(jsonb_agg(jsonb_build_array(
           round(h.lng::numeric, 6), round(h.lat::numeric, 6),
           greatest(coalesce(r.rank, 0), CASE WHEN k.house_id IS NOT NULL THEN 1 ELSE 0 END),
           CASE o.owner_occupied WHEN true THEN 1 WHEN false THEN 2 ELSE 0 END,
           CASE WHEN o.last_sale_date >= current_date - 365 THEN 1 ELSE 0 END,
           CASE WHEN rt.walkability = 'walkable' THEN 1 ELSE 0 END
         )), '[]'::jsonb)
  FROM houses h
  LEFT JOIN ranks r ON r.house_id = h.id
  LEFT JOIN known k ON k.house_id = h.id
  LEFT JOIN house_ownership o ON o.house_id = h.id
  LEFT JOIN eddm_routes rt ON rt.id = h.eddm_route_id
  WHERE h.organization_id = org AND h.kind = 'house' AND NOT h.needs_review
    AND NOT (h.lat = 0 AND h.lng = 0);
$$;

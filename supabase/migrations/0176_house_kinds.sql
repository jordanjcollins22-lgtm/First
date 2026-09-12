-- What kind of door it is: a home, a townhome, a condo, an apartment, a
-- business, a home with a business in it, an institution, or bare land.
--
-- Two things say so. The State's land-use code on the parcel, which the
-- roll gives for three in four houses; and the address itself, because an
-- address that carries a hundred units is an apartment building whatever
-- the parcel says. A business can be a home: a commercial-residential
-- parcel, a commercial parcel the owner lives on, or a home where the
-- person we know there is a business. Rebuilt per ZIP in one statement.
CREATE TABLE IF NOT EXISTS public.house_kinds (
  house_id UUID PRIMARY KEY REFERENCES public.houses(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  -- home | townhome | condo | apartment | business | home_business | institution | land | unknown
  kind TEXT NOT NULL,
  units_at_address INTEGER NOT NULL DEFAULT 1,
  basis TEXT,
  classified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS house_kinds_org_kind_idx ON public.house_kinds (organization_id, kind);

CREATE OR REPLACE FUNCTION public.classify_houses(org UUID, the_zip TEXT)
RETURNS JSONB LANGUAGE sql SET search_path = public AS $$
  WITH ours AS (
    SELECT h.id, h.normalized_address,
           regexp_replace(h.normalized_address, '\s(UNIT|APT|STE|SUITE|BLDG|LOT|FL|RM)\s\S+', '', 'g') AS base
    FROM houses h
    WHERE h.organization_id = org AND h.kind = 'house' AND NOT h.needs_review
      AND (the_zip IS NULL OR right(h.normalized_address, 5) = the_zip)
  ),
  units AS (SELECT base, count(*) AS n FROM ours GROUP BY base),
  biz_contacts AS (
    SELECT DISTINCT hc.house_id FROM house_contacts hc JOIN customers c ON c.id = hc.customer_id
    WHERE c.organization_id = org AND (
      lower(coalesce(c.contact_type, '')) IN ('business', 'company', 'commercial', 'vendor', 'partner', 'affiliate', 'property_manager', 'hoa')
      OR c.name ~* '\m(LLC|INC|CORP|CO\.|COMPANY|ASSOCIATES|PROPERTIES|MANAGEMENT|CHURCH|SCHOOL|HOA|ASSOCIATION|GROUP|SERVICES|ENTERPRISES)\M')
  ),
  judged AS (
    SELECT o.id,
           u.n AS units,
           substring(k.land_use FROM '\(([A-Z]+)\)') AS code,
           k.owner_occupied, k.year_built, b.house_id IS NOT NULL AS has_biz
    FROM ours o
    JOIN units u ON u.base = o.base
    LEFT JOIN house_ownership k ON k.house_id = o.id
    LEFT JOIN biz_contacts b ON b.house_id = o.id
  ),
  decided AS (
    SELECT id, units,
      CASE
        WHEN code = 'M' OR (units >= 5 AND code IS DISTINCT FROM 'TH' AND code IS DISTINCT FROM 'U' AND code NOT IN ('C', 'I', 'CC', 'EC')) THEN 'apartment'
        WHEN code IN ('CR', 'RC') THEN 'home_business'
        WHEN code IN ('C', 'CC', 'EC', 'I', 'CA') AND owner_occupied THEN 'home_business'
        WHEN code IN ('C', 'CC', 'EC', 'I', 'CA') THEN 'business'
        WHEN code = 'E' AND owner_occupied THEN CASE WHEN has_biz THEN 'home_business' ELSE 'home' END
        WHEN code = 'E' THEN 'institution'
        WHEN code = 'A' AND year_built IS NULL THEN 'land'
        WHEN code = 'TH' THEN CASE WHEN has_biz THEN 'home_business' ELSE 'townhome' END
        WHEN code = 'U' THEN CASE WHEN has_biz THEN 'home_business' ELSE 'condo' END
        WHEN code IN ('R', 'A') THEN CASE WHEN has_biz THEN 'home_business' ELSE 'home' END
        WHEN code IS NULL AND units >= 5 THEN 'apartment'
        WHEN code IS NULL AND units BETWEEN 2 AND 4 THEN 'townhome'
        WHEN code IS NULL AND has_biz THEN 'home_business'
        WHEN code IS NULL THEN 'home'
        ELSE 'unknown'
      END AS kind,
      concat_ws('; ',
        CASE WHEN code IS NOT NULL THEN 'State land use ' || code ELSE 'not on the State roll' END,
        CASE WHEN units >= 2 THEN units || ' units at this address' END,
        CASE WHEN owner_occupied THEN 'owner lives here' END,
        CASE WHEN has_biz THEN 'our contact here is a business' END) AS basis
    FROM judged
  ),
  written AS (
    INSERT INTO house_kinds (house_id, organization_id, kind, units_at_address, basis, classified_at)
    SELECT id, org, kind, units, basis, now() FROM decided
    ON CONFLICT (house_id) DO UPDATE SET kind = EXCLUDED.kind, units_at_address = EXCLUDED.units_at_address, basis = EXCLUDED.basis, classified_at = now()
    RETURNING kind
  )
  SELECT coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) FROM (SELECT kind, count(*) AS n FROM written GROUP BY kind) t;
$$;

-- The map's points carry the kind too: [lng, lat, stage, ownership, sold, walkable, kind]
-- with kind 0 unknown, 1 home, 2 townhome, 3 condo, 4 apartment, 5 business,
-- 6 home with a business, 7 institution, 8 land.
CREATE OR REPLACE FUNCTION public.kind_code(kind TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE kind WHEN 'home' THEN 1 WHEN 'townhome' THEN 2 WHEN 'condo' THEN 3 WHEN 'apartment' THEN 4 WHEN 'business' THEN 5
                   WHEN 'home_business' THEN 6 WHEN 'institution' THEN 7 WHEN 'land' THEN 8 ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.houses_map_points(org UUID)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
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
           CASE WHEN rt.walkability = 'walkable' THEN 1 ELSE 0 END,
           kind_code(hk.kind)
         )), '[]'::jsonb)
  FROM houses h
  LEFT JOIN ranks r ON r.house_id = h.id
  LEFT JOIN known k ON k.house_id = h.id
  LEFT JOIN house_ownership o ON o.house_id = h.id
  LEFT JOIN eddm_routes rt ON rt.id = h.eddm_route_id
  LEFT JOIN house_kinds hk ON hk.house_id = h.id
  WHERE h.organization_id = org AND h.kind = 'house' AND NOT h.needs_review
    AND NOT (h.lat = 0 AND h.lng = 0);
$$;

-- The card says what kind of door it is.
CREATE OR REPLACE FUNCTION public.house_facts(org UUID, the_house UUID)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', h.id,
    'address', h.address,
    'lat', h.lat, 'lng', h.lng,
    'countyPin', h.source = 'harford_gis',
    'kind', (SELECT jsonb_build_object('kind', hk.kind, 'units', hk.units_at_address, 'basis', hk.basis) FROM house_kinds hk WHERE hk.house_id = h.id),
    'stageRank', greatest(
      coalesce((SELECT max(CASE e.kind WHEN 'spoken_to' THEN 1 WHEN 'evaluation' THEN 2 WHEN 'proposal' THEN 3 WHEN 'client' THEN 4 WHEN 'job_completed' THEN 5 ELSE 0 END)
                FROM property_events e WHERE e.house_id = h.id), 0),
      CASE WHEN EXISTS (SELECT 1 FROM house_contacts hc WHERE hc.house_id = h.id) THEN 1 ELSE 0 END),
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', e.kind, 'at', e.occurred_at, 'amountCents', e.amount_cents, 'note', e.note) ORDER BY e.occurred_at DESC)
                        FROM (SELECT * FROM property_events e WHERE e.house_id = h.id ORDER BY e.occurred_at DESC LIMIT 8) e), '[]'::jsonb),
    'contacts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'role', hc.role, 'doNotContact', c.do_not_contact, 'contactType', c.contact_type))
                          FROM house_contacts hc JOIN customers c ON c.id = hc.customer_id WHERE hc.house_id = h.id), '[]'::jsonb),
    'ownership', (SELECT jsonb_build_object(
                    'ownerOccupied', o.owner_occupied, 'reason', o.occupancy_reason, 'ownerName', o.owner_name,
                    'lastSaleDate', o.last_sale_date, 'lastSalePrice', o.last_sale_price, 'yearBuilt', o.year_built,
                    'landUse', o.land_use, 'assessedValue', o.assessed_value, 'accountId', o.account_id, 'fetchedAt', o.fetched_at)
                  FROM house_ownership o WHERE o.house_id = h.id),
    'route', (SELECT jsonb_build_object(
                'zip', r.zip, 'routeId', r.route_id, 'walkability', r.walkability, 'reason', r.walkability_reason,
                'distanceM', round(h.eddm_route_distance_m::numeric), 'houseCount', r.house_count,
                'waveId', r.wave_id, 'waveName', w.name, 'waveStatus', w.status, 'zoneId', r.zone_id, 'zoneName', z.name,
                'zoneMode', z.mode, 'zoneMinutes', z.est_minutes)
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

-- Counts by kind, for the panel; and per zone, so a walk knows how many of
-- its doors are homes, apartments or businesses.
CREATE OR REPLACE FUNCTION public.kind_summary(org UUID)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) FROM (SELECT kind, count(*) AS n FROM house_kinds WHERE organization_id = org GROUP BY kind) t;
$$;

CREATE OR REPLACE FUNCTION public.zones_list(org UUID)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', z.id, 'name', z.name, 'zip', z.zip, 'mode', z.mode, 'houses', z.house_count,
    'pathKm', z.path_km, 'minutes', z.est_minutes, 'gapM', z.median_gap_m,
    'park', z.park_point, 'start', z.start_point, 'startAddress', z.start_address,
    'routeId', r.route_id, 'walkability', r.walkability, 'reason', r.walkability_reason, 'waveId', r.wave_id,
    'clients', (SELECT count(*) FROM zone_houses zh JOIN property_events e ON e.house_id = zh.house_id
                WHERE zh.zone_id = z.id AND e.kind IN ('client', 'job_completed')),
    'kinds', (SELECT coalesce(jsonb_object_agg(k.kind, k.n), '{}'::jsonb) FROM (
                SELECT hk.kind, count(*) AS n FROM zone_houses zh JOIN house_kinds hk ON hk.house_id = zh.house_id WHERE zh.zone_id = z.id GROUP BY hk.kind) k),
    'builtAt', z.built_at
  ) ORDER BY z.zip, z.name), '[]'::jsonb)
  FROM hanger_zones z LEFT JOIN eddm_routes r ON r.id = z.eddm_route_id
  WHERE z.organization_id = org AND z.eddm_route_id IS NOT NULL AND z.house_count > 0;
$$;

-- The door list says what kind of door: [.., ownership, lastSale, kind]
CREATE OR REPLACE FUNCTION public.houses_door_list(org UUID, ring JSONB, zips JSONB, designs INTEGER DEFAULT 1, max_rows INTEGER DEFAULT 20000)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_array(
           r.id, r.address, r.rank, r.hangs, r.dnc, least(r.hangs + 1, greatest(1, designs)), r.lat, r.lng,
           CASE o.owner_occupied WHEN true THEN 'owner' WHEN false THEN 'absentee' ELSE '' END,
           o.last_sale_date,
           coalesce(hk.kind, '')
         ) ORDER BY r.address), '[]'::jsonb)
  FROM (SELECT * FROM houses_in_shape(org, ring, zips) LIMIT max_rows) r
  LEFT JOIN house_ownership o ON o.house_id = r.id
  LEFT JOIN house_kinds hk ON hk.house_id = r.id;
$$;

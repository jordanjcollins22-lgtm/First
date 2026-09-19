-- The zone list and the marketing sync, fast enough to sit on a page.
--
-- Both were doing their work once per zone or once per job, each time
-- reading every house in the county. The sync joined houses to jobs on a
-- column with no index, so every page open scanned 117,000 houses; the
-- zone functions asked three questions of every house in every zone. Now
-- the sync has its index, and the zone functions work out who is a
-- client, what kind of door each is, and which zones have something of
-- ours in them in one pass each, then join the answers on.

CREATE INDEX IF NOT EXISTS houses_property_idx ON public.houses (property_id) WHERE property_id IS NOT NULL;

-- The zones with an evaluation, a client, or marketing to do in them.
CREATE OR REPLACE FUNCTION public.zone_active_ids(org UUID)
RETURNS TABLE (zone_id UUID) LANGUAGE sql STABLE SET search_path = public AS $$
  WITH interesting AS (
    SELECT e.house_id FROM property_events e
    WHERE e.organization_id = org AND e.kind IN ('evaluation', 'proposal', 'client', 'job_completed')
    UNION
    SELECT m.house_id FROM marketing_plays m WHERE m.organization_id = org
    UNION
    SELECT h.id FROM houses h JOIN jobs j ON j.property_id = h.property_id
    WHERE h.organization_id = org AND h.property_id IS NOT NULL AND j.status <> 'cancelled'
  )
  SELECT DISTINCT zh.zone_id FROM zone_houses zh JOIN interesting i ON i.house_id = zh.house_id;
$$;

CREATE OR REPLACE FUNCTION public.zone_is_active(the_zone UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM zone_active_ids((SELECT organization_id FROM hanger_zones WHERE id = the_zone)) a WHERE a.zone_id = the_zone);
$$;

CREATE OR REPLACE FUNCTION public.zones_geojson(org UUID)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  WITH active AS (SELECT zone_id FROM zone_active_ids(org)),
  clients AS (
    SELECT zh.zone_id, count(DISTINCT zh.house_id) AS n
    FROM zone_houses zh JOIN property_events e ON e.house_id = zh.house_id AND e.kind IN ('client', 'job_completed')
    GROUP BY zh.zone_id),
  open AS (SELECT m.zone_id, count(*) AS n FROM marketing_plays m WHERE m.organization_id = org AND m.status = 'open' AND m.zone_id IS NOT NULL GROUP BY m.zone_id)
  SELECT jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(jsonb_build_object(
    'type', 'Feature',
    'geometry', z.boundary_geojson,
    'properties', jsonb_build_object(
      'id', z.id, 'name', z.name, 'zip', z.zip, 'mode', z.mode, 'houses', z.house_count,
      'pathKm', z.path_km, 'minutes', z.est_minutes, 'gapM', z.median_gap_m,
      'park', z.park_point, 'start', z.start_point, 'startAddress', z.start_address,
      'routeId', r.route_id, 'walkability', r.walkability, 'reason', r.walkability_reason,
      'waveId', coalesce(z.wave_id, r.wave_id),
      'clients', coalesce(c.n, 0),
      'active', a.zone_id IS NOT NULL,
      'open', coalesce(o.n, 0))
  )), '[]'::jsonb))
  FROM hanger_zones z
  LEFT JOIN eddm_routes r ON r.id = z.eddm_route_id
  LEFT JOIN active a ON a.zone_id = z.id
  LEFT JOIN clients c ON c.zone_id = z.id
  LEFT JOIN open o ON o.zone_id = z.id
  WHERE z.organization_id = org AND z.boundary_geojson IS NOT NULL AND z.house_count > 0;
$$;

CREATE OR REPLACE FUNCTION public.zones_list(org UUID)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  WITH active AS (SELECT zone_id FROM zone_active_ids(org)),
  clients AS (
    SELECT zh.zone_id, count(DISTINCT zh.house_id) AS n
    FROM zone_houses zh JOIN property_events e ON e.house_id = zh.house_id AND e.kind IN ('client', 'job_completed')
    GROUP BY zh.zone_id),
  open AS (SELECT m.zone_id, count(*) AS n FROM marketing_plays m WHERE m.organization_id = org AND m.status = 'open' AND m.zone_id IS NOT NULL GROUP BY m.zone_id),
  kinds AS (
    SELECT k.zone_id, jsonb_object_agg(k.kind, k.n) AS kinds FROM (
      SELECT zh.zone_id, hk.kind, count(*) AS n
      FROM zone_houses zh JOIN house_kinds hk ON hk.house_id = zh.house_id
      GROUP BY zh.zone_id, hk.kind) k
    GROUP BY k.zone_id)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', z.id, 'name', z.name, 'zip', z.zip, 'mode', z.mode, 'houses', z.house_count,
    'pathKm', z.path_km, 'minutes', z.est_minutes, 'gapM', z.median_gap_m,
    'park', z.park_point, 'start', z.start_point, 'startAddress', z.start_address,
    'routeId', r.route_id, 'walkability', r.walkability, 'reason', r.walkability_reason, 'waveId', coalesce(z.wave_id, r.wave_id),
    'clients', coalesce(c.n, 0),
    'kinds', coalesce(k.kinds, '{}'::jsonb),
    'active', a.zone_id IS NOT NULL,
    'open', coalesce(o.n, 0),
    'builtAt', z.built_at
  ) ORDER BY z.zip, z.name), '[]'::jsonb)
  FROM hanger_zones z
  LEFT JOIN eddm_routes r ON r.id = z.eddm_route_id
  LEFT JOIN active a ON a.zone_id = z.id
  LEFT JOIN clients c ON c.zone_id = z.id
  LEFT JOIN open o ON o.zone_id = z.id
  LEFT JOIN kinds k ON k.zone_id = z.id
  WHERE z.organization_id = org AND z.eddm_route_id IS NOT NULL AND z.house_count > 0;
$$;

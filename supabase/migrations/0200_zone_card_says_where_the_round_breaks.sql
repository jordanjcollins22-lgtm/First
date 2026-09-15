-- The zone card says where the round breaks.
--
-- A zone whose roads do not join is now drawn in pieces rather than with
-- a line through the woods between them, and that is worth seeing before
-- the zone is approved: two pieces means the round is driven once in the
-- middle, and a zone with several is one that ought to be split.

CREATE OR REPLACE FUNCTION public.zones_geojson(org uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
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
      'breaks', coalesce(z.walk_breaks, 0),
      'jumpKm', round((coalesce(z.walk_jump_m, 0) / 1000.0)::numeric, 1),
      'open', coalesce(o.n, 0))
  )), '[]'::jsonb))
  FROM hanger_zones z
  LEFT JOIN eddm_routes r ON r.id = z.eddm_route_id
  LEFT JOIN active a ON a.zone_id = z.id
  LEFT JOIN clients c ON c.zone_id = z.id
  LEFT JOIN open o ON o.zone_id = z.id
  WHERE z.organization_id = org AND z.boundary_geojson IS NOT NULL AND z.house_count > 0;
$function$;

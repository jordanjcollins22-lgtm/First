-- The fault report travels with the zone, and stops the app approving a
-- dangerous round on its own say-so.
--
-- The app learns what an approved zone looks like from doors and spacing, and
-- after ten approvals in a row it starts approving like ones itself. A round
-- that crosses a trunk road thirty-four times looks exactly like a good one on
-- both of those numbers -- so without this it would sail through. The fault
-- report is the only thing that can tell them apart, and in the TypeScript
-- policy it now outranks the learning entirely: a 'bad' route always asks a
-- person, at every level of trust.
--
-- Faults are recomputed on the same tick that walks a zone, so the report is
-- never older than the route it describes, and it fails on its own -- a route
-- that could not be judged is still worth having.

CREATE OR REPLACE FUNCTION public.zones_list(org uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
    'breaks', coalesce(z.walk_breaks, 0),
    'jumpM', z.walk_jump_m,
    'quality', z.walk_quality,
    'faults', coalesce(z.walk_faults, '[]'::jsonb),
    'builtAt', z.built_at
  ) ORDER BY z.zip, z.name), '[]'::jsonb)
  FROM hanger_zones z
  LEFT JOIN eddm_routes r ON r.id = z.eddm_route_id
  LEFT JOIN active a ON a.zone_id = z.id
  LEFT JOIN clients c ON c.zone_id = z.id
  LEFT JOIN open o ON o.zone_id = z.id
  LEFT JOIN kinds k ON k.zone_id = z.id
  WHERE z.organization_id = org AND z.eddm_route_id IS NOT NULL AND z.house_count > 0;
$function$;

CREATE OR REPLACE FUNCTION public.zone_approvals(org uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'zones', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', z.id, 'name', z.name, 'approval', z.approval, 'needsApproval', zone_needs_approval(z),
        'mode', z.mode, 'houses', z.house_count, 'gapM', z.median_gap_m, 'pathKm', z.path_km, 'minutes', z.est_minutes,
        'isPart', z.wave_id IS NOT NULL, 'active', a.zone_id IS NOT NULL, 'approvedAt', z.approved_at, 'note', z.approval_note,
        'quality', z.walk_quality, 'faults', coalesce(z.walk_faults, '[]'::jsonb)))
      FROM hanger_zones z LEFT JOIN zone_active_ids(org) a ON a.zone_id = z.id
      WHERE z.organization_id = org AND z.eddm_route_id IS NOT NULL AND z.house_count > 0), '[]'::jsonb),
    'reviews', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'zoneId', r.zone_id, 'zoneName', r.zone_name, 'decision', r.decision, 'reason', r.reason, 'note', r.note,
        'mode', r.mode, 'newMode', r.new_mode, 'houses', r.houses, 'gapM', r.gap_m, 'pathKm', r.path_km, 'at', r.created_at) ORDER BY r.created_at DESC)
      FROM (SELECT * FROM zone_reviews WHERE organization_id = org ORDER BY created_at DESC LIMIT 500) r), '[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.zones_rewalk_tick(n integer DEFAULT 12)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE z RECORD; done INTEGER := 0; touched UUID[] := '{}'; t0 TIMESTAMPTZ := clock_timestamp(); left_over INTEGER;
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('zones_rewalk_tick')) THEN RETURN 0; END IF;
  FOR z IN
    SELECT hz.id, hz.organization_id, coalesce(hz.house_count, 0) AS houses FROM hanger_zones hz JOIN organizations o ON o.id = hz.organization_id
    WHERE o.roads_updated_at IS NOT NULL AND (hz.walked_at IS NULL OR hz.walked_at < o.roads_updated_at)
    ORDER BY hz.house_count ASC NULLS FIRST, hz.id
    LIMIT n
  LOOP
    EXIT WHEN clock_timestamp() - t0 > interval '25 seconds';
    EXIT WHEN z.houses > 600 AND clock_timestamp() - t0 > interval '15 seconds';
    BEGIN
      PERFORM zone_walk(z.id);
      -- The fault report is a read of what the walk just drew. It fails on its
      -- own: a route that could not be judged is worth having anyway.
      BEGIN
        PERFORM zone_walk_faults(z.id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'zones_rewalk_tick: faults for zone % failed: %', z.id, SQLERRM;
      END;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'zones_rewalk_tick: zone % failed: %', z.id, SQLERRM;
    END;
    UPDATE hanger_zones SET walked_at = now() WHERE id = z.id;
    done := done + 1;
    IF NOT z.organization_id = ANY (touched) THEN touched := touched || z.organization_id; END IF;
  END LOOP;
  IF done > 0 THEN
    SELECT count(*) INTO left_over FROM hanger_zones hz JOIN organizations o ON o.id = hz.organization_id
    WHERE o.roads_updated_at IS NOT NULL AND (hz.walked_at IS NULL OR hz.walked_at < o.roads_updated_at);
    IF left_over = 0 THEN
      PERFORM summaries_refresh(o, ARRAY['zones_list', 'zones_geojson']) FROM unnest(touched) o;
    END IF;
  END IF;
  PERFORM pg_advisory_unlock(hashtext('zones_rewalk_tick'));
  RETURN done;
END $function$;

-- Every zone already walked gets its report now rather than waiting for the
-- roads to change.
SELECT public.zone_walk_faults(id) FROM public.hanger_zones WHERE walk_line IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- Evaluate the row-security helpers once per query, not once per row.
--
-- Every policy read `organization_id = current_org_id()`. That function is
-- SECURITY DEFINER, so Postgres cannot inline it and calls it for every row
-- it looks at: a lookup on the houses table paid for 117,000 profile reads
-- before it returned 66 rows, and the marketing plays list took six to
-- eight seconds on every open of My Day. Written as `(select
-- current_org_id())` the planner runs it once as an InitPlan and compares
-- rows against the answer.
--
-- Done for every policy in one pass rather than table by table, so the next
-- table somebody adds by copying an old policy is the only one left slow.

DO $$
DECLARE
  p record;
  new_qual text;
  new_check text;
  stmt text;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    new_qual := regexp_replace(regexp_replace(regexp_replace(regexp_replace(p.qual,
      '(?<!select )current_org_id\(\)', '(select current_org_id())', 'gi'),
      '(?<!select )auth\.uid\(\)', '(select auth.uid())', 'gi'),
      '(?<!select )is_admin\(\)', '(select is_admin())', 'gi'),
      '(?<!select )is_superadmin\(\)', '(select is_superadmin())', 'gi');
    new_check := regexp_replace(regexp_replace(regexp_replace(regexp_replace(p.with_check,
      '(?<!select )current_org_id\(\)', '(select current_org_id())', 'gi'),
      '(?<!select )auth\.uid\(\)', '(select auth.uid())', 'gi'),
      '(?<!select )is_admin\(\)', '(select is_admin())', 'gi'),
      '(?<!select )is_superadmin\(\)', '(select is_superadmin())', 'gi');

    IF new_qual IS NOT DISTINCT FROM p.qual AND new_check IS NOT DISTINCT FROM p.with_check THEN
      CONTINUE;
    END IF;

    stmt := format('ALTER POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    IF new_qual IS NOT NULL THEN
      stmt := stmt || format(' USING (%s)', new_qual);
    END IF;
    IF new_check IS NOT NULL THEN
      stmt := stmt || format(' WITH CHECK (%s)', new_check);
    END IF;
    EXECUTE stmt;
  END LOOP;
END $$;

-- The address list on a play joined its handful of ids against houses, and
-- the planner, guessing at how many ids a play holds, hash-joined them
-- against a full walk of the houses table, once per play. A scalar lookup
-- per id can only be a primary-key probe, so that is what it is now.
CREATE OR REPLACE FUNCTION public.marketing_plays_list(org uuid, include_done boolean DEFAULT true)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'houseId', m.house_id, 'address', h.address, 'lat', h.lat, 'lng', h.lng,
    'jobId', m.job_id, 'customerId', m.customer_id, 'customerName', c.name,
    'reason', m.reason, 'kind', m.kind, 'quantity', m.quantity,
    'zoneId', m.zone_id, 'zoneName', z.name, 'zoneMode', z.mode,
    'zoneApproved', CASE WHEN z.id IS NULL THEN NULL ELSE NOT zone_needs_approval(z) END,
    'approval', m.approval, 'approvedAt', m.approved_at,
    'assignedTo', m.assigned_to,
    'assignedToName', coalesce(ap.full_name, ap.email),
    'assignedAt', m.assigned_at,
    'removedCount', jsonb_array_length(m.removed), 'targets', m.targets,
    'status', m.status, 'doneAt', m.done_at, 'doneBy', pr.full_name,
    'mailingId', m.mailing_id, 'createdAt', m.created_at,
    'targetAddresses', CASE WHEN m.kind IN ('knocks', 'yard_sign') THEN (
      SELECT jsonb_agg((SELECT th.address FROM houses th WHERE th.id = (o.id)::uuid) ORDER BY o.ord)
      FROM jsonb_array_elements_text(m.targets) WITH ORDINALITY o(id, ord)) ELSE NULL END
  ) ORDER BY (m.status = 'open') DESC, m.created_at DESC, m.kind), '[]'::jsonb)
  FROM marketing_plays m
  JOIN houses h ON h.id = m.house_id
  LEFT JOIN customers c ON c.id = m.customer_id
  LEFT JOIN hanger_zones z ON z.id = m.zone_id
  LEFT JOIN profiles pr ON pr.id = m.done_by
  LEFT JOIN profiles ap ON ap.id = m.assigned_to
  WHERE m.organization_id = org AND (include_done OR m.status = 'open');
$function$;

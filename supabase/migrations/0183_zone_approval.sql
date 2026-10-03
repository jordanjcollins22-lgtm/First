-- A zone goes on the map only once a person has said it is right.
--
-- The build draws the zones; a person approves them. Until one is
-- approved it is not on the map and not a walk anybody is sent on: it
-- waits in a queue, shown one at a time for a look. Every decision is
-- kept, with what the zone looked like at the time, so the app can learn
-- what an approved zone looks like. After ten approvals in a row with no
-- corrections the app approves zones like the ones already approved on
-- its own and asks only about the unusual ones; after twenty-five, only
-- the exceptional. One correction and it goes back to asking about all.
-- The policy itself is in the app (zone-approval.ts); the database keeps
-- the facts and applies the decisions.
--
-- A zone approved and then rebuilt differently -- another mode, or a
-- tenth more or fewer doors -- is a different zone and asks again.

ALTER TABLE public.hanger_zones
  -- pending | approved | auto | rejected
  ADD COLUMN IF NOT EXISTS approval TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- What was approved, so a rebuild that changes the zone asks again.
  ADD COLUMN IF NOT EXISTS approved_mode TEXT,
  ADD COLUMN IF NOT EXISTS approved_houses INTEGER,
  ADD COLUMN IF NOT EXISTS approval_note TEXT;

CREATE TABLE IF NOT EXISTS public.zone_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  zone_id UUID REFERENCES public.hanger_zones(id) ON DELETE SET NULL,
  zone_name TEXT,
  -- approve | reject | auto
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'auto')),
  -- For a rejection: mode | shape | walk | split | other. For an auto approval: why.
  reason TEXT,
  note TEXT,
  -- The zone as it was when judged.
  mode TEXT,
  new_mode TEXT,
  houses INTEGER,
  gap_m REAL,
  path_km REAL,
  est_minutes INTEGER,
  reviewer UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zone_reviews_org_idx ON public.zone_reviews (organization_id, created_at DESC);

-- Whether a zone still needs a person: never approved, rejected, or
-- approved as something else.
CREATE OR REPLACE FUNCTION public.zone_needs_approval(z public.hanger_zones)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT z.approval NOT IN ('approved', 'auto')
    OR z.approved_mode IS DISTINCT FROM z.mode
    OR abs(coalesce(z.house_count, 0) - coalesce(z.approved_houses, 0)) > greatest(10, coalesce(z.approved_houses, 0) / 10);
$$;

-- One decision about one zone, recorded and applied.
CREATE OR REPLACE FUNCTION public.zone_review(org UUID, the_zone UUID, decision TEXT, reason TEXT DEFAULT NULL, note TEXT DEFAULT NULL, new_mode TEXT DEFAULT NULL, by UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE z RECORD;
BEGIN
  SELECT * INTO z FROM hanger_zones WHERE id = the_zone AND organization_id = org;
  IF z.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'No such zone.'); END IF;
  IF decision NOT IN ('approve', 'reject', 'auto') THEN RETURN jsonb_build_object('ok', false, 'error', 'Not a decision.'); END IF;
  IF new_mode IS NOT NULL AND new_mode NOT IN ('foot', 'scooter', 'vehicle') THEN RETURN jsonb_build_object('ok', false, 'error', 'Not a mode.'); END IF;

  INSERT INTO zone_reviews (organization_id, zone_id, zone_name, decision, reason, note, mode, new_mode, houses, gap_m, path_km, est_minutes, reviewer)
  VALUES (org, z.id, z.name, decision, reason, note, z.mode, new_mode, z.house_count, z.median_gap_m, z.path_km, z.est_minutes, by);

  IF decision IN ('approve', 'auto') THEN
    UPDATE hanger_zones SET approval = decision, approved_at = now(), approved_by = by, approved_mode = mode, approved_houses = house_count, approval_note = note, updated_at = now()
    WHERE id = z.id;
  ELSE
    -- A corrected mode is applied at once; the zone then asks again as
    -- what it now is.
    UPDATE hanger_zones SET approval = 'rejected', approved_at = NULL, approved_by = NULL, approved_mode = NULL, approved_houses = NULL, approval_note = note,
      mode = coalesce(new_mode, mode), updated_at = now()
    WHERE id = z.id;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- The approval state of every zone, tiny, read on its own so approving
-- one zone never waits for the kept zone list to be rebuilt.
CREATE OR REPLACE FUNCTION public.zone_approvals(org UUID)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'zones', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', z.id, 'name', z.name, 'approval', z.approval, 'needsApproval', zone_needs_approval(z),
        'mode', z.mode, 'houses', z.house_count, 'gapM', z.median_gap_m, 'pathKm', z.path_km, 'minutes', z.est_minutes,
        'isPart', z.wave_id IS NOT NULL, 'active', a.zone_id IS NOT NULL, 'approvedAt', z.approved_at, 'note', z.approval_note))
      FROM hanger_zones z LEFT JOIN zone_active_ids(org) a ON a.zone_id = z.id
      WHERE z.organization_id = org AND z.eddm_route_id IS NOT NULL AND z.house_count > 0), '[]'::jsonb),
    'reviews', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'zoneId', r.zone_id, 'zoneName', r.zone_name, 'decision', r.decision, 'reason', r.reason, 'note', r.note,
        'mode', r.mode, 'newMode', r.new_mode, 'houses', r.houses, 'gapM', r.gap_m, 'pathKm', r.path_km, 'at', r.created_at) ORDER BY r.created_at DESC)
      FROM (SELECT * FROM zone_reviews WHERE organization_id = org ORDER BY created_at DESC LIMIT 500) r), '[]'::jsonb));
$$;

-- The plays say when their zone is still waiting for approval.
CREATE OR REPLACE FUNCTION public.marketing_plays_list(org UUID, include_done BOOLEAN DEFAULT true)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'houseId', m.house_id, 'address', h.address, 'lat', h.lat, 'lng', h.lng,
    'jobId', m.job_id, 'customerId', m.customer_id, 'customerName', c.name,
    'reason', m.reason, 'kind', m.kind, 'quantity', m.quantity,
    'zoneId', m.zone_id, 'zoneName', z.name, 'zoneMode', z.mode,
    'zoneApproved', CASE WHEN z.id IS NULL THEN NULL ELSE NOT zone_needs_approval(z) END,
    'targets', m.targets, 'status', m.status, 'doneAt', m.done_at, 'doneBy', pr.full_name,
    'mailingId', m.mailing_id, 'createdAt', m.created_at,
    'targetAddresses', CASE WHEN m.kind IN ('knocks', 'yard_sign') THEN
      (SELECT jsonb_agg(t.address ORDER BY t.ord) FROM (
         SELECT th.address, o.ord FROM jsonb_array_elements_text(m.targets) WITH ORDINALITY o(id, ord)
         JOIN houses th ON th.id = (o.id)::uuid) t) ELSE NULL END
  ) ORDER BY (m.status = 'open') DESC, m.created_at DESC, m.kind), '[]'::jsonb)
  FROM marketing_plays m
  JOIN houses h ON h.id = m.house_id
  LEFT JOIN customers c ON c.id = m.customer_id
  LEFT JOIN hanger_zones z ON z.id = m.zone_id
  LEFT JOIN profiles pr ON pr.id = m.done_by
  WHERE m.organization_id = org AND (include_done OR m.status = 'open');
$$;

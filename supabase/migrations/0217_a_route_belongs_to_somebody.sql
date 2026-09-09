-- A door-hanger round belongs to somebody, and can be walked and edited.
--
-- Three things, all about the same object: an approved round was work nobody
-- owned, in an order nobody could follow, that could only ever be made smaller.
--
-- 1. ASSIGNMENT. The obvious owner is already recorded -- the round exists
--    because somebody did an evaluation on that street, and that person has
--    just been there. So approving a round assigns it to whoever the evaluation
--    was assigned to, unless a person has already been named. It is set on
--    approval rather than creation: a play nobody has approved is a suggestion,
--    and putting somebody's name on a suggestion is how a to-do list fills with
--    work that was never agreed. Reassignment stays open -- this is a sensible
--    default, not a rule.
--
--    marketing_play_review writes the decision verb straight into the column,
--    so an approved play reads 'approve', not 'approved'. Both spellings are
--    accepted: the TypeScript type has long said "approved" and nothing
--    noticed, so matching one is how this silently stops working.
--
-- 2. THE WALKING ORDER. marketing_play_doors returns the round's doors in the
--    order they were chosen -- nearest the client's house first, which is how
--    they were picked and not how they are walked. The optimal order already
--    exists in the zone's walk_path; marketing_play_route matches each door to
--    its place in that walk, so a hundred doors out of a four-hundred-door zone
--    are still walked the way the zone is walked.
--
-- 3. ADDING DOORS. Removing a door has always been possible and adding one had
--    no path at all, so a round could only shrink -- and the four houses round
--    the corner that obviously belong to the same walk could never be put on.
--    Only houses inside the round's own zone qualify: a round is a walk, and a
--    door three miles outside it is not on that walk.

ALTER TABLE public.marketing_plays
  ADD COLUMN IF NOT EXISTS assigned_to UUID,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_by UUID;

CREATE INDEX IF NOT EXISTS marketing_plays_assigned_idx
  ON public.marketing_plays (assigned_to, status)
  WHERE assigned_to IS NOT NULL;

CREATE OR REPLACE FUNCTION public.marketing_play_assign_on_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE evaluator UUID;
BEGIN
  IF NEW.approval NOT IN ('approve', 'approved', 'auto') THEN RETURN NEW; END IF;
  IF NEW.assigned_to IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.approval IS NOT DISTINCT FROM NEW.approval THEN RETURN NEW; END IF;

  SELECT j.assigned_to INTO evaluator FROM jobs j WHERE j.id = NEW.job_id;
  IF evaluator IS NULL THEN RETURN NEW; END IF;

  NEW.assigned_to := evaluator;
  NEW.assigned_at := now();
  -- Nobody pressed a button, so nobody is recorded as having done it.
  NEW.assigned_by := NULL;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS marketing_play_assigns_itself ON public.marketing_plays;
CREATE TRIGGER marketing_play_assigns_itself
  BEFORE INSERT OR UPDATE OF approval ON public.marketing_plays
  FOR EACH ROW EXECUTE FUNCTION public.marketing_play_assign_on_approval();

-- The rounds already approved get the same treatment, once.
UPDATE public.marketing_plays p
SET assigned_to = j.assigned_to, assigned_at = coalesce(p.approved_at, now())
FROM public.jobs j
WHERE j.id = p.job_id
  AND p.assigned_to IS NULL
  AND j.assigned_to IS NOT NULL
  AND p.approval IN ('approve', 'approved', 'auto');

-- The list carries who it belongs to.
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
      SELECT jsonb_agg(t.address ORDER BY t.ord) FROM (
        SELECT th.address, o.ord FROM jsonb_array_elements_text(m.targets) WITH ORDINALITY o(id, ord)
        JOIN houses th ON th.id = (o.id)::uuid) t) ELSE NULL END
  ) ORDER BY (m.status = 'open') DESC, m.created_at DESC, m.kind), '[]'::jsonb)
  FROM marketing_plays m
  JOIN houses h ON h.id = m.house_id
  LEFT JOIN customers c ON c.id = m.customer_id
  LEFT JOIN hanger_zones z ON z.id = m.zone_id
  LEFT JOIN profiles pr ON pr.id = m.done_by
  LEFT JOIN profiles ap ON ap.id = m.assigned_to
  WHERE m.organization_id = org AND (include_done OR m.status = 'open');
$function$;

-- The doors of one round, in the order somebody should actually walk them.
CREATE OR REPLACE FUNCTION public.marketing_play_route(the_play uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH play AS (
    SELECT m.id, m.targets, m.zone_id, z.walk_path, z.park_point, z.mode, z.name AS zone_name
    FROM marketing_plays m
    LEFT JOIN hanger_zones z ON z.id = m.zone_id
    WHERE m.id = the_play
  ),
  walk AS (
    SELECT o.ord, (o.step->>'lat')::float8 AS lat, (o.step->>'lng')::float8 AS lng
    FROM play p, jsonb_array_elements(coalesce(p.walk_path, '[]'::jsonb)) WITH ORDINALITY o(step, ord)
  ),
  doors AS (
    SELECT th.id, th.address, th.lat, th.lng, o.ord AS chosen_ord
    FROM play p, jsonb_array_elements_text(p.targets) WITH ORDINALITY o(id, ord)
    JOIN houses th ON th.id = (o.id)::uuid
    WHERE th.lat IS NOT NULL AND th.lng IS NOT NULL
  ),
  -- Each door takes the number of the walk stop it sits closest to. A zone
  -- never walked falls back to the order the doors were chosen in: worse, but
  -- not wrong, and better than refusing to start.
  placed AS (
    SELECT d.id, d.address, d.lat, d.lng,
           coalesce((SELECT w.ord FROM walk w
                     ORDER BY (w.lat - d.lat) ^ 2 + (w.lng - d.lng) ^ 2 LIMIT 1), d.chosen_ord) AS seq,
           d.chosen_ord
    FROM doors d
  )
  SELECT jsonb_build_object(
    'zoneName', (SELECT zone_name FROM play),
    'mode', (SELECT mode FROM play),
    'park', (SELECT park_point FROM play),
    'walked', (SELECT walk_path IS NOT NULL FROM play),
    'doors', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', id, 'address', address, 'lat', lat, 'lng', lng)
                       ORDER BY seq, chosen_ord)
      FROM placed), '[]'::jsonb)
  );
$function$;

-- Doors can be put back on a round, not only taken off.
CREATE OR REPLACE FUNCTION public.marketing_play_add_doors(org uuid, the_play uuid, add uuid[], by uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE p RECORD; allowed UUID[]; fresh JSONB; before INTEGER; after INTEGER;
BEGIN
  PERFORM assert_own_org(org);
  SELECT * INTO p FROM marketing_plays WHERE id = the_play AND organization_id = org;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'That round is not there.'); END IF;
  IF p.kind NOT IN ('door_hangers', 'knocks', 'yard_sign') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That kind of play has no doors to add.');
  END IF;
  IF add IS NULL OR array_length(add, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No doors given.');
  END IF;

  SELECT array_agg(DISTINCT h.id) INTO allowed
  FROM unnest(add) AS a(id)
  JOIN houses h ON h.id = a.id
  WHERE h.lat IS NOT NULL AND h.lng IS NOT NULL
    AND (p.zone_id IS NULL OR EXISTS (
      SELECT 1 FROM zone_houses zh WHERE zh.zone_id = p.zone_id AND zh.house_id = h.id))
    AND NOT (p.targets ? h.id::text);

  IF allowed IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'None of those doors are in this zone.');
  END IF;

  before := jsonb_array_length(p.targets);
  fresh := p.targets || to_jsonb(allowed);
  after := jsonb_array_length(fresh);

  UPDATE marketing_plays
  SET targets = fresh,
      quantity = after,
      -- A door put back is no longer a door somebody took off.
      removed = coalesce((
        SELECT jsonb_agg(r) FROM jsonb_array_elements(coalesce(removed, '[]'::jsonb)) r
        WHERE NOT (r #>> '{}' = ANY (SELECT x::text FROM unnest(allowed) x))), '[]'::jsonb),
      updated_at = now()
  WHERE id = the_play;

  INSERT INTO marketing_play_reviews (organization_id, play_id, kind, reason, decision,
                                      quantity_before, quantity_after, note, reviewer)
  VALUES (org, the_play, p.kind, p.reason, 'edit', before, after,
          format('%s door(s) added by hand', array_length(allowed, 1)), by);

  RETURN jsonb_build_object('ok', true, 'quantity', after, 'added', array_length(allowed, 1));
END $function$;

NOTIFY pgrst, 'reload schema';

-- A marketing play is approved before it is done, can be edited first,
-- and the app learns from the edits.
--
-- A door-hanger route made by the app is a proposal: the hundred doors
-- nearest the house. Before anyone walks it a person looks at it, takes
-- out the doors that are wrong (across the highway, the far end of a
-- lane), sets how many it should be, and approves it. Every look is
-- kept: what was removed and how far away it was, what the count became.
-- From those the app learns the count the business actually wants and
-- how far from the house a hanger is worth carrying, and makes the next
-- plays that way. After ten plays of a kind approved in a row without a
-- change, it approves that kind on its own; one change and it asks
-- again. The policy is in the app (marketing-approval.ts); the database
-- keeps the facts, applies the edits, and refuses to tick off a play
-- nobody approved.

ALTER TABLE public.marketing_plays
  -- pending | approved | auto
  ADD COLUMN IF NOT EXISTS approval TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Doors (or routes) a person took out; never chosen again for this play.
  ADD COLUMN IF NOT EXISTS removed JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.marketing_play_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  play_id UUID REFERENCES public.marketing_plays(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  reason TEXT,
  -- approve | auto | edit
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'auto', 'edit')),
  quantity_before INTEGER,
  quantity_after INTEGER,
  removed_count INTEGER NOT NULL DEFAULT 0,
  -- How far from the house the farthest kept door is, and the nearest removed one.
  kept_max_m REAL,
  removed_min_m REAL,
  note TEXT,
  reviewer UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketing_play_reviews_org_idx ON public.marketing_play_reviews (organization_id, created_at DESC);

-- What the business has taught the app a play should be.
CREATE TABLE IF NOT EXISTS public.marketing_defaults (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  quantity INTEGER,
  max_distance_m REAL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, kind)
);

-- The doors for hangers, now within a learned reach and never the ones a
-- person took out.
CREATE OR REPLACE FUNCTION public.marketing_hanger_targets(the_house UUID, wanted INTEGER DEFAULT 100, max_m DOUBLE PRECISION DEFAULT NULL, skip UUID[] DEFAULT '{}')
RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE h RECORD; z UUID; out JSONB;
BEGIN
  SELECT * INTO h FROM houses WHERE id = the_house;
  IF h.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT zone_id INTO z FROM zone_houses WHERE house_id = the_house LIMIT 1;
  IF z IS NOT NULL THEN
    SELECT jsonb_agg(id) INTO out FROM (
      SELECT n.id FROM zone_houses zh JOIN houses n ON n.id = zh.house_id
      WHERE zh.zone_id = z AND n.id <> h.id AND n.kind = 'house' AND NOT n.needs_review AND NOT (n.id = ANY (skip))
        AND (max_m IS NULL OR ST_DWithin(house_geom(n.lng, n.lat)::geography, house_geom(h.lng, h.lat)::geography, max_m))
      ORDER BY house_geom(n.lng, n.lat) <-> house_geom(h.lng, h.lat) LIMIT wanted) s;
  ELSE
    SELECT jsonb_agg(id) INTO out FROM (
      SELECT n.id FROM houses n
      WHERE n.organization_id = h.organization_id AND n.id <> h.id AND n.kind = 'house' AND NOT n.needs_review AND NOT (n.id = ANY (skip))
        AND house_geom(n.lng, n.lat) && ST_Expand(house_geom(h.lng, h.lat), 0.007)
        AND ST_DWithin(house_geom(n.lng, n.lat)::geography, house_geom(h.lng, h.lat)::geography, least(coalesce(max_m, 600), 600))
      ORDER BY house_geom(n.lng, n.lat) <-> house_geom(h.lng, h.lat) LIMIT wanted) s;
  END IF;
  RETURN coalesce(out, '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.marketing_default_quantity(org UUID, the_kind TEXT, fallback INTEGER)
RETURNS INTEGER LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce((SELECT quantity FROM marketing_defaults WHERE organization_id = org AND kind = the_kind), fallback);
$$;
CREATE OR REPLACE FUNCTION public.marketing_default_reach(org UUID, the_kind TEXT)
RETURNS DOUBLE PRECISION LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (SELECT max_distance_m FROM marketing_defaults WHERE organization_id = org AND kind = the_kind)::double precision;
$$;

-- The sync, making plays the way the business has taught it to.
CREATE OR REPLACE FUNCTION public.marketing_sync(org UUID)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE c RECORD; since TIMESTAMPTZ; made INTEGER := 0; hangers_recent BOOLEAN; z UUID; t JSONB;
  q_hangers INTEGER; reach DOUBLE PRECISION; q_flyers INTEGER;
BEGIN
  SELECT marketing_since INTO since FROM organizations WHERE id = org;
  IF since IS NULL THEN RETURN jsonb_build_object('made', 0); END IF;
  q_hangers := marketing_default_quantity(org, 'door_hangers', 100);
  reach := marketing_default_reach(org, 'door_hangers');
  q_flyers := marketing_default_quantity(org, 'flyers', 1000);

  FOR c IN
    SELECT DISTINCT ON (h.id) h.id AS house_id, j.id AS job_id, p.customer_id
    FROM jobs j
    JOIN properties p ON p.id = j.property_id
    JOIN customers cu ON cu.id = p.customer_id
    JOIN houses h ON h.property_id = p.id AND h.kind = 'house' AND NOT h.needs_review
    WHERE cu.organization_id = org AND j.status <> 'cancelled'
      AND j.evaluation_status IN ('scheduled', 'on_way', 'arrived', 'completed')
      AND coalesce(j.evaluation_date::timestamptz, j.created_at) >= since - interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM marketing_plays m WHERE m.house_id = h.id AND m.reason = 'evaluation' AND m.kind = 'door_hangers')
    ORDER BY h.id, j.created_at DESC
  LOOP
    SELECT zone_id INTO z FROM zone_houses WHERE house_id = c.house_id LIMIT 1;
    t := marketing_hanger_targets(c.house_id, q_hangers, reach);
    INSERT INTO marketing_plays (organization_id, house_id, job_id, customer_id, reason, kind, quantity, zone_id, targets)
    VALUES (org, c.house_id, c.job_id, c.customer_id, 'evaluation', 'door_hangers', jsonb_array_length(t), z, t)
    ON CONFLICT DO NOTHING;
    made := made + 1;
  END LOOP;

  FOR c IN
    SELECT DISTINCT ON (x.house_id) x.house_id, x.job_id, x.customer_id, x.at FROM (
      SELECT h.id AS house_id, e.job_id, e.customer_id, e.occurred_at AS at
      FROM property_events e JOIN houses h ON h.id = e.house_id
      WHERE e.organization_id = org AND e.kind IN ('client', 'job_completed') AND h.kind = 'house' AND NOT h.needs_review
        AND e.occurred_at >= since - interval '30 days'
      UNION ALL
      SELECT h.id, j.id, p.customer_id, j.updated_at
      FROM jobs j
      JOIN properties p ON p.id = j.property_id
      JOIN customers cu ON cu.id = p.customer_id
      JOIN houses h ON h.property_id = p.id AND h.kind = 'house' AND NOT h.needs_review
      WHERE cu.organization_id = org AND j.status IN ('approved', 'in_progress', 'completed')
        AND j.updated_at >= since - interval '30 days'
    ) x
    WHERE NOT EXISTS (SELECT 1 FROM marketing_plays m WHERE m.house_id = x.house_id AND m.reason = 'client')
    ORDER BY x.house_id, x.at DESC
  LOOP
    IF EXISTS (SELECT 1 FROM marketing_plays m WHERE m.house_id = c.house_id AND m.reason = 'client') THEN CONTINUE; END IF;
    SELECT zone_id INTO z FROM zone_houses WHERE house_id = c.house_id LIMIT 1;

    INSERT INTO marketing_plays (organization_id, house_id, job_id, customer_id, reason, kind, quantity, zone_id, targets)
    VALUES (org, c.house_id, c.job_id, c.customer_id, 'client', 'yard_sign', 1, z, jsonb_build_array(c.house_id))
    ON CONFLICT DO NOTHING;

    t := marketing_knock_targets(c.house_id);
    INSERT INTO marketing_plays (organization_id, house_id, job_id, customer_id, reason, kind, quantity, zone_id, targets)
    VALUES (org, c.house_id, c.job_id, c.customer_id, 'client', 'knocks', jsonb_array_length(t), z, t)
    ON CONFLICT DO NOTHING;

    SELECT EXISTS (SELECT 1 FROM marketing_plays m WHERE m.house_id = c.house_id AND m.kind = 'door_hangers'
                   AND (m.status = 'open' OR m.done_at > now() - interval '60 days')) INTO hangers_recent;
    IF NOT hangers_recent THEN
      t := marketing_hanger_targets(c.house_id, q_hangers, reach);
      INSERT INTO marketing_plays (organization_id, house_id, job_id, customer_id, reason, kind, quantity, zone_id, targets)
      VALUES (org, c.house_id, c.job_id, c.customer_id, 'client', 'door_hangers', jsonb_array_length(t), z, t)
      ON CONFLICT DO NOTHING;
    END IF;

    t := marketing_flyer_routes(c.house_id, q_flyers);
    INSERT INTO marketing_plays (organization_id, house_id, job_id, customer_id, reason, kind, quantity, zone_id, targets)
    VALUES (org, c.house_id, c.job_id, c.customer_id, 'client', 'flyers',
            coalesce((SELECT sum((p->>'pieces')::integer) FROM jsonb_array_elements(t) p), 0), z, t)
    ON CONFLICT DO NOTHING;
    made := made + 1;
  END LOOP;

  RETURN jsonb_build_object('made', made);
END $$;

-- The doors of a play, in order, with how far each is from the house.
CREATE OR REPLACE FUNCTION public.marketing_play_doors(the_play UUID)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'address', t.address, 'lat', t.lat, 'lng', t.lng, 'distM', t.dist) ORDER BY t.ord), '[]'::jsonb)
  FROM marketing_plays m
  JOIN houses h ON h.id = m.house_id
  CROSS JOIN LATERAL (
    SELECT th.id, th.address, th.lat, th.lng, o.ord,
           round(ST_Distance(house_geom(th.lng, th.lat)::geography, house_geom(h.lng, h.lat)::geography)) AS dist
    FROM jsonb_array_elements_text(m.targets) WITH ORDINALITY o(id, ord)
    JOIN houses th ON th.id = (o.id)::uuid) t
  WHERE m.id = the_play AND m.kind IN ('door_hangers', 'knocks', 'yard_sign');
$$;

-- A person's word on a play: approve it, or change it.
CREATE OR REPLACE FUNCTION public.marketing_play_review(org UUID, the_play UUID, decision TEXT, remove UUID[] DEFAULT NULL, set_quantity INTEGER DEFAULT NULL, note TEXT DEFAULT NULL, by UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE p RECORD; before INTEGER; after INTEGER; new_targets JSONB; new_removed JSONB; kept_max DOUBLE PRECISION; removed_min DOUBLE PRECISION; n_removed INTEGER := 0; hg geometry;
BEGIN
  SELECT * INTO p FROM marketing_plays WHERE id = the_play AND organization_id = org;
  IF p.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'No such play.'); END IF;
  IF decision NOT IN ('approve', 'auto', 'edit') THEN RETURN jsonb_build_object('ok', false, 'error', 'Not a decision.'); END IF;
  before := p.quantity; after := p.quantity; new_targets := p.targets; new_removed := p.removed;
  SELECT house_geom(h.lng, h.lat) INTO hg FROM houses h WHERE h.id = p.house_id;

  IF decision = 'edit' THEN
    IF remove IS NOT NULL AND array_length(remove, 1) > 0 THEN
      IF p.kind = 'flyers' THEN
        SELECT coalesce(jsonb_agg(r), '[]'::jsonb) INTO new_targets FROM jsonb_array_elements(p.targets) r WHERE NOT ((r->>'id')::uuid = ANY (remove));
        n_removed := jsonb_array_length(p.targets) - jsonb_array_length(new_targets);
      ELSE
        SELECT coalesce(jsonb_agg(t.value), '[]'::jsonb) INTO new_targets FROM jsonb_array_elements_text(p.targets) t WHERE NOT (t.value::uuid = ANY (remove));
        n_removed := jsonb_array_length(p.targets) - jsonb_array_length(new_targets);
        SELECT min(ST_Distance(house_geom(h.lng, h.lat)::geography, hg::geography)) INTO removed_min FROM houses h WHERE h.id = ANY (remove);
      END IF;
      new_removed := new_removed || to_jsonb(remove);
    END IF;
    IF set_quantity IS NOT NULL AND p.kind = 'door_hangers' AND set_quantity <> jsonb_array_length(new_targets) THEN
      new_targets := marketing_hanger_targets(p.house_id, set_quantity, marketing_default_reach(org, 'door_hangers'),
        coalesce((SELECT array_agg(v::uuid) FROM jsonb_array_elements_text(new_removed) v), '{}'::uuid[]));
    ELSIF set_quantity IS NOT NULL AND p.kind = 'knocks' AND set_quantity < jsonb_array_length(new_targets) THEN
      SELECT coalesce(jsonb_agg(t.value ORDER BY t.ord), '[]'::jsonb) INTO new_targets FROM jsonb_array_elements_text(new_targets) WITH ORDINALITY t(value, ord) WHERE t.ord <= set_quantity;
    END IF;
    after := CASE WHEN p.kind = 'flyers' THEN coalesce((SELECT sum((r->>'pieces')::integer) FROM jsonb_array_elements(new_targets) r), 0) ELSE jsonb_array_length(new_targets) END;
    IF p.kind <> 'flyers' THEN
      SELECT max(ST_Distance(house_geom(h.lng, h.lat)::geography, hg::geography)) INTO kept_max
      FROM jsonb_array_elements_text(new_targets) t JOIN houses h ON h.id = t.value::uuid;
    END IF;
    UPDATE marketing_plays SET targets = new_targets, quantity = after, removed = new_removed, approval = 'pending', approved_at = NULL, approved_by = NULL, updated_at = now()
    WHERE id = p.id;
  ELSE
    IF p.kind <> 'flyers' THEN
      SELECT max(ST_Distance(house_geom(h.lng, h.lat)::geography, hg::geography)) INTO kept_max
      FROM jsonb_array_elements_text(p.targets) t JOIN houses h ON h.id = t.value::uuid;
    END IF;
    UPDATE marketing_plays SET approval = decision, approved_at = now(), approved_by = by, updated_at = now() WHERE id = p.id;
  END IF;

  INSERT INTO marketing_play_reviews (organization_id, play_id, kind, reason, decision, quantity_before, quantity_after, removed_count, kept_max_m, removed_min_m, note, reviewer)
  VALUES (org, p.id, p.kind, p.reason, decision, before, after, n_removed, kept_max, removed_min, note, by);
  RETURN jsonb_build_object('ok', true, 'quantity', after, 'removed', n_removed);
END $$;

-- A play is ticked off only once approved.
CREATE OR REPLACE FUNCTION public.marketing_play_set(the_play UUID, new_status TEXT, by UUID, designs INTEGER DEFAULT 1)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE p RECORD; recorded INTEGER := 0; stamp TIMESTAMPTZ := now();
BEGIN
  SELECT * INTO p FROM marketing_plays WHERE id = the_play;
  IF p.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'No such play.'); END IF;
  IF new_status NOT IN ('open', 'done', 'skipped') THEN RETURN jsonb_build_object('ok', false, 'error', 'Not a status.'); END IF;
  IF new_status = 'done' AND p.approval = 'pending' THEN RETURN jsonb_build_object('ok', false, 'error', 'Approve it first.'); END IF;

  IF p.status = 'done' AND new_status <> 'done' AND p.kind = 'door_hangers' AND p.done_at IS NOT NULL THEN
    DELETE FROM door_hanger_events d
    WHERE d.organization_id = p.organization_id AND d.hung_at = p.done_at
      AND d.house_id IN (SELECT t.value::uuid FROM jsonb_array_elements_text(p.targets) t);
  END IF;

  IF new_status = 'done' AND p.status <> 'done' AND p.kind = 'door_hangers' THEN
    INSERT INTO door_hanger_events (organization_id, house_id, zone_id, design_number, hung_at, hung_by)
    SELECT p.organization_id, t.value::uuid, p.zone_id,
           least(greatest(1, designs), (SELECT count(*) FROM door_hanger_events d WHERE d.house_id = t.value::uuid) + 1),
           stamp, by
    FROM jsonb_array_elements_text(p.targets) t;
    GET DIAGNOSTICS recorded = ROW_COUNT;
  END IF;

  UPDATE marketing_plays SET status = new_status,
    done_at = CASE WHEN new_status = 'done' THEN stamp ELSE NULL END,
    done_by = CASE WHEN new_status = 'done' THEN by ELSE NULL END,
    updated_at = stamp
  WHERE id = the_play;
  RETURN jsonb_build_object('ok', true, 'recorded', recorded);
END $$;

CREATE OR REPLACE FUNCTION public.marketing_plays_list(org UUID, include_done BOOLEAN DEFAULT true)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'houseId', m.house_id, 'address', h.address, 'lat', h.lat, 'lng', h.lng,
    'jobId', m.job_id, 'customerId', m.customer_id, 'customerName', c.name,
    'reason', m.reason, 'kind', m.kind, 'quantity', m.quantity,
    'zoneId', m.zone_id, 'zoneName', z.name, 'zoneMode', z.mode,
    'zoneApproved', CASE WHEN z.id IS NULL THEN NULL ELSE NOT zone_needs_approval(z) END,
    'approval', m.approval, 'approvedAt', m.approved_at, 'removedCount', jsonb_array_length(m.removed),
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

-- What the app has to learn from: the decisions, and what it has learned.
CREATE OR REPLACE FUNCTION public.marketing_approval_state(org UUID)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'reviews', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'playId', r.play_id, 'kind', r.kind, 'reason', r.reason, 'decision', r.decision,
        'quantityBefore', r.quantity_before, 'quantityAfter', r.quantity_after, 'removedCount', r.removed_count,
        'keptMaxM', r.kept_max_m, 'removedMinM', r.removed_min_m, 'at', r.created_at) ORDER BY r.created_at DESC)
      FROM (SELECT * FROM marketing_play_reviews WHERE organization_id = org ORDER BY created_at DESC LIMIT 500) r), '[]'::jsonb),
    'defaults', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', d.kind, 'quantity', d.quantity, 'maxDistanceM', d.max_distance_m))
      FROM marketing_defaults d WHERE d.organization_id = org), '[]'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.marketing_defaults_set(org UUID, the_kind TEXT, the_quantity INTEGER, the_reach DOUBLE PRECISION)
RETURNS VOID LANGUAGE sql SET search_path = public AS $$
  INSERT INTO marketing_defaults (organization_id, kind, quantity, max_distance_m, updated_at)
  VALUES (org, the_kind, the_quantity, the_reach, now())
  ON CONFLICT (organization_id, kind) DO UPDATE SET quantity = EXCLUDED.quantity, max_distance_m = EXCLUDED.max_distance_m, updated_at = now();
$$;

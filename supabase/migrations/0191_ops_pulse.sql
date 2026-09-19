-- The pulse of the business, and the ramp that answers it.
--
-- The office should not have to notice that evaluations have dried up, that
-- proposals are not closing, that the booked work runs out in a fortnight or
-- that the cash is low. The database keeps the numbers (ops_pulse), the app
-- judges them against what the business wants (ops_targets) and, when they
-- are off, spends on the marketing that costs the least per job won. The
-- plays it makes are ordinary marketing plays with the reason 'ramp', so they
-- go through the same approval, the same tick, the same learning. What was
-- done, when, and for how much is kept (ops_actions).

-- What the business wants, and the cash it has: the only numbers typed in.
CREATE TABLE IF NOT EXISTS public.ops_targets (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  evaluations_per_week INTEGER NOT NULL DEFAULT 5,
  close_rate REAL NOT NULL DEFAULT 0.4,
  weeks_booked_ahead REAL NOT NULL DEFAULT 3,
  -- Cash in the bank on a day, typed in; the app carries it forward with
  -- what has come in and gone out since.
  cash_on_hand NUMERIC,
  cash_as_of DATE,
  -- Below this the business is in trouble; defaults to two months' overhead.
  cash_floor NUMERIC,
  -- The share of the cash above the floor the ramp may spend in a month.
  marketing_share REAL NOT NULL DEFAULT 0.25,
  -- Whether the ramp makes the plays itself or only proposes them.
  auto_ramp BOOLEAN NOT NULL DEFAULT true,
  -- {door_hangers: 0.45, flyers: 0.28, ...}: the cost of a unit of each
  -- lever, when the business knows better than the defaults.
  lever_costs JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What the ramp did, each time.
CREATE TABLE IF NOT EXISTS public.ops_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- steady | ramp | all_out
  mode TEXT NOT NULL,
  budget NUMERIC NOT NULL DEFAULT 0,
  -- [{lever, units, cost, expectedEvaluations, why}]
  plan JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- [{playId, kind, quantity, address}]
  made JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- 'app' when the daily tick did it, else the person.
  by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_actions_org_idx ON public.ops_actions (organization_id, created_at DESC);

-- A play the ramp made is a play like any other, with its own reason.
ALTER TABLE public.marketing_plays DROP CONSTRAINT IF EXISTS marketing_plays_reason_check;
ALTER TABLE public.marketing_plays ADD CONSTRAINT marketing_plays_reason_check CHECK (reason IN ('evaluation', 'client', 'ramp'));

-- The numbers. Eight weeks of history, this week included; what is on the
-- table now; the money; and what each marketing lever has brought in.
CREATE OR REPLACE FUNCTION public.ops_pulse(org UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  week0 DATE := date_trunc('week', now())::date;
  since DATE; weeks JSONB; now_j JSONB; cash_j JSONB; levers JSONB; plays_j JSONB;
BEGIN
  SELECT coalesce(cash_as_of, (now() - interval '30 days')::date) INTO since FROM ops_targets WHERE organization_id = org;
  since := coalesce(since, (now() - interval '30 days')::date);

  -- The last eight weeks, oldest first.
  WITH w AS (SELECT generate_series(week0 - interval '7 weeks', week0, interval '1 week')::date AS start),
  org_jobs AS (
    SELECT j.*, p.customer_id FROM jobs j JOIN properties p ON p.id = j.property_id JOIN customers c ON c.id = p.customer_id
    WHERE c.organization_id = org),
  ev AS (SELECT date_trunc('week', evaluation_date::timestamptz)::date AS wk, count(*) AS n FROM org_jobs
         WHERE evaluation_date IS NOT NULL AND evaluation_status <> 'cancelled' AND status <> 'cancelled' GROUP BY 1),
  sent AS (SELECT date_trunc('week', approved_at)::date AS wk, count(*) AS n, coalesce(sum(total_cost), 0) AS v FROM job_proposals
           WHERE organization_id = org AND approved_at IS NOT NULL GROUP BY 1),
  won AS (SELECT date_trunc('week', coalesce(responded_at, updated_at))::date AS wk, count(*) AS n, coalesce(sum(total_cost), 0) AS v FROM job_proposals
          WHERE organization_id = org AND status = 'accepted' GROUP BY 1),
  lost AS (SELECT date_trunc('week', coalesce(responded_at, updated_at))::date AS wk, count(*) AS n FROM job_proposals
           WHERE organization_id = org AND status = 'declined' GROUP BY 1),
  done AS (SELECT date_trunc('week', j.completed_at)::date AS wk, count(*) AS n, coalesce(sum(pr.total_cost), 0) AS v
           FROM org_jobs j LEFT JOIN job_proposals pr ON pr.job_id = j.id AND pr.status = 'accepted'
           WHERE j.completed_at IS NOT NULL GROUP BY 1),
  cin AS (SELECT wk, sum(v) AS v FROM (
            SELECT date_trunc('week', paid_at)::date AS wk, amount AS v FROM invoices WHERE organization_id = org AND status = 'paid' AND paid_at IS NOT NULL
            UNION ALL SELECT date_trunc('week', occurred_on::timestamptz)::date, amount FROM ledger_entries WHERE organization_id = org AND direction = 'in') x GROUP BY 1),
  cout AS (SELECT wk, sum(v) AS v FROM (
            SELECT date_trunc('week', occurred_on::timestamptz)::date AS wk, amount AS v FROM ledger_entries WHERE organization_id = org AND direction = 'out'
            UNION ALL SELECT date_trunc('week', coalesce(paid_at, created_at))::date, amount FROM team_payments WHERE organization_id = org AND status = 'paid') x GROUP BY 1)
  SELECT jsonb_agg(jsonb_build_object(
    'week', w.start, 'evaluations', coalesce(ev.n, 0), 'proposalsSent', coalesce(sent.n, 0), 'sentValue', coalesce(sent.v, 0),
    'won', coalesce(won.n, 0), 'wonValue', coalesce(won.v, 0), 'lost', coalesce(lost.n, 0),
    'completed', coalesce(done.n, 0), 'completedValue', coalesce(done.v, 0),
    'cashIn', coalesce(cin.v, 0), 'cashOut', coalesce(cout.v, 0)) ORDER BY w.start)
  INTO weeks
  FROM w LEFT JOIN ev ON ev.wk = w.start LEFT JOIN sent ON sent.wk = w.start LEFT JOIN won ON won.wk = w.start
  LEFT JOIN lost ON lost.wk = w.start LEFT JOIN done ON done.wk = w.start LEFT JOIN cin ON cin.wk = w.start LEFT JOIN cout ON cout.wk = w.start;

  -- On the table now.
  WITH org_jobs AS (
    SELECT j.*, p.address, c.name AS customer_name FROM jobs j JOIN properties p ON p.id = j.property_id JOIN customers c ON c.id = p.customer_id
    WHERE c.organization_id = org)
  SELECT jsonb_build_object(
    'scheduledAhead', (SELECT count(*) FROM org_jobs WHERE evaluation_date::date >= current_date AND evaluation_status IN ('scheduled', 'on_way', 'arrived') AND status <> 'cancelled'),
    'scheduledNext14', (SELECT count(*) FROM org_jobs WHERE evaluation_date::date BETWEEN current_date AND current_date + 14 AND evaluation_status IN ('scheduled', 'on_way', 'arrived') AND status <> 'cancelled'),
    'proposalsOpen', coalesce((SELECT jsonb_agg(jsonb_build_object('id', pr.id, 'jobId', pr.job_id, 'customer', j.customer_name, 'address', j.address,
        'total', pr.total_cost, 'sentAt', pr.approved_at, 'daysOpen', extract(day FROM now() - pr.approved_at)::int) ORDER BY pr.total_cost DESC NULLS LAST)
      FROM job_proposals pr JOIN org_jobs j ON j.id = pr.job_id WHERE pr.organization_id = org AND pr.status = 'sent'), '[]'::jsonb),
    'proposalsNeedsApproval', (SELECT count(*) FROM job_proposals WHERE organization_id = org AND status = 'needs_approval'),
    'unwritten', coalesce((SELECT jsonb_agg(jsonb_build_object('jobId', j.id, 'customer', j.customer_name, 'address', j.address, 'evaluatedAt', j.evaluation_date,
        'daysAgo', greatest(0, current_date - j.evaluation_date::date)) ORDER BY j.evaluation_date)
      FROM org_jobs j WHERE j.evaluation_status = 'completed' AND j.status = 'estimating'
        AND NOT EXISTS (SELECT 1 FROM job_proposals pr WHERE pr.job_id = j.id AND pr.status <> 'needs_approval')), '[]'::jsonb),
    'bookedJobs', (SELECT count(*) FROM org_jobs j WHERE j.status IN ('approved', 'in_progress')),
    'bookedValue', coalesce((SELECT sum(pr.total_cost) FROM org_jobs j JOIN job_proposals pr ON pr.job_id = j.id AND pr.status = 'accepted' WHERE j.status IN ('approved', 'in_progress')), 0),
    'avgTicket', (SELECT avg(total_cost) FROM job_proposals WHERE organization_id = org AND status = 'accepted' AND total_cost > 0 AND coalesce(responded_at, updated_at) > now() - interval '180 days'),
    'avgTicketAll', (SELECT avg(total_cost) FROM job_proposals WHERE organization_id = org AND status = 'accepted' AND total_cost > 0),
    'activeClients', (SELECT count(DISTINCT j.customer_name) FROM org_jobs j WHERE j.status IN ('approved', 'in_progress', 'completed')),
    'pastClients', coalesce((SELECT jsonb_agg(jsonb_build_object('customerId', x.customer_id, 'customer', x.customer_name, 'lastJobAt', x.last_at) ORDER BY x.last_at)
      FROM (SELECT p.customer_id, j.customer_name, max(coalesce(j.completed_at, j.updated_at)) AS last_at
            FROM org_jobs j JOIN properties p ON p.id = j.property_id WHERE j.status = 'completed'
            GROUP BY 1, 2 HAVING max(coalesce(j.completed_at, j.updated_at)) < now() - interval '120 days') x), '[]'::jsonb)
  ) INTO now_j;

  -- The money.
  SELECT jsonb_build_object(
    'invoicesOutstanding', coalesce((SELECT sum(amount) FROM invoices WHERE organization_id = org AND status = 'open'), 0),
    'teamOwed', coalesce((SELECT sum(amount) FROM team_payments WHERE organization_id = org AND status = 'pending'), 0),
    'overheadMonthly', coalesce((SELECT sum(amount) FROM overhead_expenses WHERE organization_id = org), 0),
    'inSince', coalesce((SELECT sum(amount) FROM invoices WHERE organization_id = org AND status = 'paid' AND paid_at::date > since), 0)
              + coalesce((SELECT sum(amount) FROM ledger_entries WHERE organization_id = org AND direction = 'in' AND occurred_on > since), 0),
    'outSince', coalesce((SELECT sum(amount) FROM ledger_entries WHERE organization_id = org AND direction = 'out' AND occurred_on > since), 0)
               + coalesce((SELECT sum(amount) FROM team_payments WHERE organization_id = org AND status = 'paid' AND coalesce(paid_at, created_at)::date > since), 0),
    'since', since,
    'crewCostPerHour', (SELECT crew_cost_per_hour FROM organizations WHERE id = org),
    'postagePerPiece', (SELECT eddm_postage_per_piece FROM organizations WHERE id = org),
    'printCostPerPiece', (SELECT eddm_print_cost_per_piece FROM organizations WHERE id = org)
  ) INTO cash_j;

  -- What each lever has done: units put out in the last 180 days, and the
  -- evaluations that followed at the doors they reached, within 120 days.
  WITH evals AS (
    SELECT h.id AS house_id, j.evaluation_date::timestamptz AS at
    FROM jobs j JOIN properties p ON p.id = j.property_id JOIN customers c ON c.id = p.customer_id JOIN houses h ON h.property_id = p.id
    WHERE c.organization_id = org AND j.evaluation_date IS NOT NULL AND j.evaluation_status <> 'cancelled'
    UNION
    SELECT e.house_id, e.occurred_at FROM property_events e WHERE e.organization_id = org AND e.kind = 'evaluation'),
  hangs AS (SELECT d.house_id, d.hung_at FROM door_hanger_events d WHERE d.organization_id = org AND d.hung_at > now() - interval '180 days'),
  knocks AS (SELECT (t.value)::uuid AS house_id, m.done_at FROM marketing_plays m, jsonb_array_elements_text(m.targets) t
             WHERE m.organization_id = org AND m.kind = 'knocks' AND m.status = 'done' AND m.done_at > now() - interval '180 days'),
  signs AS (SELECT m.house_id, m.done_at FROM marketing_plays m WHERE m.organization_id = org AND m.kind = 'yard_sign' AND m.status = 'done' AND m.done_at > now() - interval '180 days'),
  mail AS (SELECT (r->>'id')::uuid AS route_id, e.pieces, e.mailed_on::timestamptz AS at FROM eddm_mailings e, jsonb_array_elements(e.routes) r
           WHERE e.organization_id = org AND e.mailed_on IS NOT NULL AND e.mailed_on > now() - interval '180 days')
  SELECT jsonb_build_object(
    'door_hangers', jsonb_build_object('units', (SELECT count(*) FROM hangs),
      'evaluations', (SELECT count(DISTINCT ev.house_id) FROM hangs x JOIN evals ev ON ev.house_id = x.house_id AND ev.at > x.hung_at AND ev.at < x.hung_at + interval '120 days')),
    'knocks', jsonb_build_object('units', (SELECT count(*) FROM knocks),
      'evaluations', (SELECT count(DISTINCT ev.house_id) FROM knocks x JOIN evals ev ON ev.house_id = x.house_id AND ev.at > x.done_at AND ev.at < x.done_at + interval '120 days')),
    'yard_sign', jsonb_build_object('units', (SELECT count(*) FROM signs),
      'evaluations', (SELECT count(DISTINCT ev.house_id) FROM signs x JOIN houses sh ON sh.id = x.house_id
                      JOIN houses eh ON ST_DWithin(house_geom(eh.lng, eh.lat)::geography, house_geom(sh.lng, sh.lat)::geography, 300) AND eh.id <> sh.id
                      JOIN evals ev ON ev.house_id = eh.id AND ev.at > x.done_at AND ev.at < x.done_at + interval '120 days')),
    'flyers', jsonb_build_object('units', coalesce((SELECT sum(pieces) FROM eddm_mailings e WHERE e.organization_id = org AND e.mailed_on IS NOT NULL AND e.mailed_on > now() - interval '180 days'), 0),
      'evaluations', (SELECT count(DISTINCT ev.house_id) FROM mail x JOIN houses h ON h.eddm_route_id = x.route_id
                      JOIN evals ev ON ev.house_id = h.id AND ev.at > x.at AND ev.at < x.at + interval '90 days'))
  ) INTO levers;

  -- The marketing to do, as it stands.
  SELECT jsonb_build_object(
    'pendingApproval', count(*) FILTER (WHERE status = 'open' AND approval = 'pending'),
    'open', count(*) FILTER (WHERE status = 'open'),
    'openByKind', coalesce((SELECT jsonb_object_agg(k, n) FROM (SELECT kind AS k, count(*) AS n FROM marketing_plays WHERE organization_id = org AND status = 'open' GROUP BY 1) x), '{}'::jsonb),
    'oldestOpenDays', coalesce(max(extract(day FROM now() - created_at)::int) FILTER (WHERE status = 'open'), 0),
    'doneLast30', count(*) FILTER (WHERE status = 'done' AND done_at > now() - interval '30 days'),
    'rampOpenUnits', coalesce(sum(quantity) FILTER (WHERE status = 'open' AND reason = 'ramp'), 0)
  ) INTO plays_j FROM marketing_plays WHERE organization_id = org;

  RETURN jsonb_build_object('at', now(), 'weekStart', week0, 'weeks', weeks, 'now', now_j, 'cash', cash_j, 'levers', levers, 'plays', plays_j);
END $$;

-- The pulse is one of the kept answers, refreshed with the rest.
CREATE OR REPLACE FUNCTION public.summary_keys()
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['ownership_summary', 'relationship_ownership_matrix', 'kind_summary', 'zones_list', 'zones_geojson',
               'eddm_unserved_cells', 'houses_map_points', 'houses_unserved_points', 'ops_pulse'];
$$;
CREATE OR REPLACE FUNCTION public.summary_compute(org UUID, the_key TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
BEGIN
  RETURN CASE the_key
    WHEN 'ownership_summary' THEN ownership_summary(org)
    WHEN 'relationship_ownership_matrix' THEN relationship_ownership_matrix(org)
    WHEN 'kind_summary' THEN kind_summary(org)
    WHEN 'zones_list' THEN zones_list(org)
    WHEN 'zones_geojson' THEN zones_geojson(org)
    WHEN 'eddm_unserved_cells' THEN eddm_unserved_cells(org)
    WHEN 'houses_map_points' THEN houses_map_points(org)
    WHEN 'houses_unserved_points' THEN houses_unserved_points(org)
    WHEN 'ops_pulse' THEN ops_pulse(org)
    ELSE NULL
  END;
END $$;

-- The ramp: the plan the app settled on, made into plays.
--
-- plan is [{lever, units}]. Door hangers go round the houses with the most
-- recent evaluations and clients whose zone has no hangers play open, a
-- zone at a time, never to a door hung in the last sixty days. Flyers go on
-- the USPS routes round the most recent clients. Knocks go to the five doors
-- round the most recent evaluations. Signs need a client, so the ramp does
-- not make them. Every play is 'ramp', pending approval like any other.
CREATE OR REPLACE FUNCTION public.ops_ramp(org UUID, the_mode TEXT, budget NUMERIC, plan JSONB, by UUID DEFAULT NULL, note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE a JSONB; lever TEXT; units INTEGER; left_over INTEGER; c RECORD; t JSONB; z UUID; q INTEGER; reach DOUBLE PRECISION;
  recent UUID[]; made JSONB := '[]'::jsonb; new_id UUID; n INTEGER;
BEGIN
  q := marketing_default_quantity(org, 'door_hangers', 100);
  reach := marketing_default_reach(org, 'door_hangers');
  SELECT coalesce(array_agg(DISTINCT house_id), '{}') INTO recent FROM door_hanger_events WHERE organization_id = org AND hung_at > now() - interval '60 days';

  FOR a IN SELECT * FROM jsonb_array_elements(plan) LOOP
    lever := a->>'lever'; units := coalesce((a->>'units')::integer, 0); left_over := units;
    IF units <= 0 THEN CONTINUE; END IF;

    IF lever = 'door_hangers' THEN
      FOR c IN
        SELECT h.id AS house_id, x.job_id, x.customer_id, x.at FROM (
          SELECT e.house_id, e.job_id, e.customer_id, e.occurred_at AS at FROM property_events e
          WHERE e.organization_id = org AND e.kind IN ('client', 'evaluation', 'job_completed') AND e.occurred_at > now() - interval '365 days'
          UNION ALL
          SELECT h.id, j.id, p.customer_id, coalesce(j.evaluation_date::timestamptz, j.created_at)
          FROM jobs j JOIN properties p ON p.id = j.property_id JOIN customers cu ON cu.id = p.customer_id JOIN houses h ON h.property_id = p.id
          WHERE cu.organization_id = org AND j.status <> 'cancelled'
        ) x JOIN houses h ON h.id = x.house_id AND h.kind = 'house' AND NOT h.needs_review
        ORDER BY x.at DESC
      LOOP
        EXIT WHEN left_over <= 0;
        SELECT zone_id INTO z FROM zone_houses WHERE house_id = c.house_id LIMIT 1;
        CONTINUE WHEN z IS NULL;
        CONTINUE WHEN EXISTS (SELECT 1 FROM marketing_plays m WHERE m.zone_id = z AND m.kind = 'door_hangers' AND m.status = 'open');
        CONTINUE WHEN EXISTS (SELECT 1 FROM marketing_plays m WHERE m.zone_id = z AND m.kind = 'door_hangers' AND m.reason = 'ramp' AND m.created_at > now() - interval '60 days');
        t := marketing_hanger_targets(c.house_id, least(left_over, q), reach, recent);
        n := jsonb_array_length(t);
        CONTINUE WHEN n = 0;
        INSERT INTO marketing_plays (organization_id, house_id, job_id, customer_id, reason, kind, quantity, zone_id, targets, note)
        VALUES (org, c.house_id, c.job_id, c.customer_id, 'ramp', 'door_hangers', n, z, t, note)
        ON CONFLICT DO NOTHING RETURNING id INTO new_id;
        CONTINUE WHEN new_id IS NULL;
        made := made || jsonb_build_object('playId', new_id, 'kind', 'door_hangers', 'quantity', n, 'zoneId', z);
        left_over := left_over - n;
      END LOOP;

    ELSIF lever = 'flyers' THEN
      FOR c IN
        SELECT h.id AS house_id, e.job_id, e.customer_id FROM property_events e JOIN houses h ON h.id = e.house_id AND h.kind = 'house' AND NOT h.needs_review
        WHERE e.organization_id = org AND e.kind IN ('client', 'job_completed')
          AND NOT EXISTS (SELECT 1 FROM marketing_plays m WHERE m.house_id = h.id AND m.kind = 'flyers' AND (m.status = 'open' OR m.done_at > now() - interval '90 days'))
        ORDER BY e.occurred_at DESC
      LOOP
        EXIT WHEN left_over < 200;
        t := marketing_flyer_routes(c.house_id, left_over);
        SELECT coalesce(sum((p->>'pieces')::integer), 0) INTO n FROM jsonb_array_elements(t) p;
        CONTINUE WHEN n = 0;
        SELECT zone_id INTO z FROM zone_houses WHERE house_id = c.house_id LIMIT 1;
        INSERT INTO marketing_plays (organization_id, house_id, job_id, customer_id, reason, kind, quantity, zone_id, targets, note)
        VALUES (org, c.house_id, c.job_id, c.customer_id, 'ramp', 'flyers', n, z, t, note)
        ON CONFLICT DO NOTHING RETURNING id INTO new_id;
        CONTINUE WHEN new_id IS NULL;
        made := made || jsonb_build_object('playId', new_id, 'kind', 'flyers', 'quantity', n, 'zoneId', z);
        left_over := left_over - n;
      END LOOP;

    ELSIF lever = 'knocks' THEN
      FOR c IN
        SELECT h.id AS house_id, x.job_id, x.customer_id FROM (
          SELECT e.house_id, e.job_id, e.customer_id, e.occurred_at AS at FROM property_events e
          WHERE e.organization_id = org AND e.kind IN ('evaluation', 'client', 'job_completed') AND e.occurred_at > now() - interval '365 days'
          UNION ALL
          SELECT h.id, j.id, p.customer_id, coalesce(j.evaluation_date::timestamptz, j.created_at)
          FROM jobs j JOIN properties p ON p.id = j.property_id JOIN customers cu ON cu.id = p.customer_id JOIN houses h ON h.property_id = p.id
          WHERE cu.organization_id = org AND j.status <> 'cancelled'
        ) x JOIN houses h ON h.id = x.house_id AND h.kind = 'house' AND NOT h.needs_review
        WHERE NOT EXISTS (SELECT 1 FROM marketing_plays m WHERE m.house_id = h.id AND m.kind = 'knocks')
        ORDER BY x.at DESC
      LOOP
        EXIT WHEN left_over <= 0;
        t := marketing_knock_targets(c.house_id);
        n := jsonb_array_length(t);
        CONTINUE WHEN n = 0;
        SELECT zone_id INTO z FROM zone_houses WHERE house_id = c.house_id LIMIT 1;
        INSERT INTO marketing_plays (organization_id, house_id, job_id, customer_id, reason, kind, quantity, zone_id, targets, note)
        VALUES (org, c.house_id, c.job_id, c.customer_id, 'ramp', 'knocks', n, z, t, note)
        ON CONFLICT DO NOTHING RETURNING id INTO new_id;
        CONTINUE WHEN new_id IS NULL;
        made := made || jsonb_build_object('playId', new_id, 'kind', 'knocks', 'quantity', n, 'zoneId', z);
        left_over := left_over - n;
      END LOOP;
    END IF;
  END LOOP;

  INSERT INTO ops_actions (organization_id, mode, budget, plan, made, by, note) VALUES (org, the_mode, coalesce(budget, 0), plan, made, by, note);
  IF jsonb_array_length(made) > 0 THEN
    PERFORM summaries_refresh(org, ARRAY['zones_list', 'zones_geojson', 'ops_pulse']);
  END IF;
  RETURN jsonb_build_object('made', jsonb_array_length(made), 'plays', made);
END $$;

-- The last few things the ramp did, for the panel.
CREATE OR REPLACE FUNCTION public.ops_actions_list(org UUID, n INTEGER DEFAULT 5)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'mode', a.mode, 'budget', a.budget, 'plan', a.plan, 'made', jsonb_array_length(a.made),
    'by', pr.full_name, 'note', a.note, 'at', a.created_at) ORDER BY a.created_at DESC), '[]'::jsonb)
  FROM (SELECT * FROM ops_actions WHERE organization_id = org ORDER BY created_at DESC LIMIT n) a
  LEFT JOIN profiles pr ON pr.id = a.by;
$$;

REVOKE ALL ON FUNCTION public.ops_ramp(UUID, TEXT, NUMERIC, JSONB, UUID, TEXT) FROM PUBLIC, anon;

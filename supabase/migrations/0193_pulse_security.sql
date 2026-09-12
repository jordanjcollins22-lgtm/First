-- The pulse tells the truth, and only to the business it belongs to.
--
-- Two faults in what went before, both found on the live app.
--
-- The first is money safety. ops_pulse ran as whoever called it, and the
-- overhead table is only readable by somebody holding the "overhead" role.
-- An admin without that role opening My Day recomputed the pulse with the
-- overhead at nothing, wrote that into the shared cache for everybody, and
-- from there the cash floor defaulted to two months of nothing: the app
-- could never say the money was low, and the marketing allowance was a
-- quarter of all the cash in the bank rather than a quarter of what sat
-- above the floor. The numbers a business steers by cannot depend on who
-- happened to open the page, so ops_pulse now runs as its owner and sees
-- the whole business, whoever asks.
--
-- The second is that anything reachable with a signed-in session must be
-- scoped to one business. There are two on this database. The cached
-- answers, the targets, what the ramp did, the roads, and (worst) the bank
-- balances and transactions were all readable across the two. Every one of
-- those tables now has row security. The bank's are deny-all: the office
-- sees the bank through bank_status and nothing else needs the rows.
--
-- And every function that takes an organisation as an argument now checks
-- that it is the caller's own, so an id cannot simply be swapped.

-- The check itself. The service role has no signed-in user and is the
-- crons and the background jobs; a person may only ask about their own.
CREATE OR REPLACE FUNCTION public.assert_own_org(org UUID)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF org IS DISTINCT FROM (SELECT organization_id FROM profiles WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'That is not your organisation.' USING ERRCODE = '42501';
  END IF;
END $$;

-- Row security on everything a session could otherwise read across
-- businesses. The bank's rows are read by bank_status and the background
-- jobs alone, so they get no policy at all.
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.summary_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS summary_cache_own_org ON public.summary_cache;
CREATE POLICY summary_cache_own_org ON public.summary_cache FOR ALL TO authenticated
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

ALTER TABLE public.ops_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ops_targets_own_org ON public.ops_targets;
CREATE POLICY ops_targets_own_org ON public.ops_targets FOR ALL TO authenticated
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

ALTER TABLE public.ops_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ops_actions_own_org ON public.ops_actions;
CREATE POLICY ops_actions_own_org ON public.ops_actions FOR ALL TO authenticated
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

ALTER TABLE public.road_segments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS road_segments_own_org ON public.road_segments;
CREATE POLICY road_segments_own_org ON public.road_segments FOR ALL TO authenticated
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- The bank, asked about by name rather than by id.
CREATE OR REPLACE FUNCTION public.bank_status(org UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM assert_own_org(org);
  RETURN (SELECT jsonb_build_object(
    'linked', EXISTS (SELECT 1 FROM bank_links WHERE organization_id = org),
    'cash', bank_cash(org),
    'links', coalesce((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'institution', l.institution_name, 'status', l.status, 'lastError', l.last_error,
        'lastSyncedAt', l.last_synced_at, 'linkedAt', l.created_at) ORDER BY l.created_at) FROM bank_links l WHERE l.organization_id = org), '[]'::jsonb),
    'accounts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'accountId', a.account_id, 'linkId', a.link_id, 'name', a.name, 'mask', a.mask, 'type', a.type, 'subtype', a.subtype,
        'current', a.current_balance, 'available', a.available_balance, 'balanceAt', a.balance_at, 'include', a.include) ORDER BY a.include DESC, a.name)
      FROM bank_accounts a WHERE a.organization_id = org), '[]'::jsonb),
    'transactions30', (SELECT count(*) FROM bank_transactions t WHERE t.organization_id = org AND t.posted_on > current_date - 30)
  ));
END $$;

-- The kept answers, and the recomputing of them.
CREATE OR REPLACE FUNCTION public.summary_get(org UUID, the_key TEXT, max_age INTERVAL DEFAULT '45 minutes')
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE c RECORD;
BEGIN
  PERFORM assert_own_org(org);
  SELECT value, computed_at INTO c FROM summary_cache WHERE organization_id = org AND key = the_key;
  IF c.value IS NOT NULL AND c.computed_at > now() - max_age THEN RETURN c.value; END IF;
  RETURN summary_refresh(org, the_key);
END $$;

CREATE OR REPLACE FUNCTION public.summary_refresh(org UUID, the_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE t0 TIMESTAMPTZ := clock_timestamp(); v JSONB;
BEGIN
  PERFORM assert_own_org(org);
  v := summary_compute(org, the_key);
  INSERT INTO summary_cache (organization_id, key, value, computed_at, took_ms)
  VALUES (org, the_key, v, now(), (extract(epoch FROM clock_timestamp() - t0) * 1000)::integer)
  ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value, computed_at = EXCLUDED.computed_at, took_ms = EXCLUDED.took_ms;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.summaries_refresh(org UUID, keys TEXT[] DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE k TEXT; took JSONB := '{}'::jsonb; t0 TIMESTAMPTZ;
BEGIN
  PERFORM assert_own_org(org);
  FOREACH k IN ARRAY coalesce(keys, summary_keys()) LOOP
    t0 := clock_timestamp();
    PERFORM summary_refresh(org, k);
    took := took || jsonb_build_object(k, (extract(epoch FROM clock_timestamp() - t0) * 1000)::integer);
  END LOOP;
  RETURN took;
END $$;

-- The ramp, which spends money, only ever for the caller's own business.
CREATE OR REPLACE FUNCTION public.ops_ramp(org UUID, the_mode TEXT, budget NUMERIC, plan JSONB, by UUID DEFAULT NULL, note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE a JSONB; lever TEXT; units INTEGER; left_over INTEGER; c RECORD; t JSONB; z UUID; q INTEGER; reach DOUBLE PRECISION;
  recent UUID[]; made JSONB := '[]'::jsonb; new_id UUID; n INTEGER;
BEGIN
  PERFORM assert_own_org(org);
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
        new_id := NULL;
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
        new_id := NULL;
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
        new_id := NULL;
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

CREATE OR REPLACE FUNCTION public.ops_actions_list(org UUID, n INTEGER DEFAULT 5)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM assert_own_org(org);
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'mode', a.mode, 'budget', a.budget, 'plan', a.plan, 'made', jsonb_array_length(a.made),
    'by', pr.full_name, 'note', a.note, 'at', a.created_at) ORDER BY a.created_at DESC), '[]'::jsonb)
  FROM (SELECT * FROM ops_actions WHERE organization_id = org ORDER BY created_at DESC LIMIT n) a
  LEFT JOIN profiles pr ON pr.id = a.by);
END $$;

-- The pulse itself, as its owner: the same numbers for everybody, and the
-- overhead among them, whatever roles the person reading holds.
CREATE OR REPLACE FUNCTION public.ops_pulse(org UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  week0 DATE := date_trunc('week', now())::date;
  since DATE; weeks JSONB; now_j JSONB; cash_j JSONB; levers JSONB; plays_j JSONB; banked BOOLEAN;
BEGIN
  PERFORM assert_own_org(org);
  SELECT coalesce(cash_as_of, (now() - interval '30 days')::date) INTO since FROM ops_targets WHERE organization_id = org;
  since := coalesce(since, (now() - interval '30 days')::date);
  banked := EXISTS (SELECT 1 FROM bank_accounts WHERE organization_id = org AND include);

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
            SELECT date_trunc('week', posted_on::timestamptz)::date AS wk, -amount AS v FROM bank_transactions
            WHERE organization_id = org AND banked AND amount < 0 AND NOT pending AND coalesce(category, '') NOT LIKE 'TRANSFER%'
            UNION ALL SELECT date_trunc('week', paid_at)::date, amount FROM invoices WHERE organization_id = org AND NOT banked AND status = 'paid' AND paid_at IS NOT NULL
            UNION ALL SELECT date_trunc('week', occurred_on::timestamptz)::date, amount FROM ledger_entries WHERE organization_id = org AND NOT banked AND direction = 'in') x GROUP BY 1),
  cout AS (SELECT wk, sum(v) AS v FROM (
            SELECT date_trunc('week', posted_on::timestamptz)::date AS wk, amount AS v FROM bank_transactions
            WHERE organization_id = org AND banked AND amount > 0 AND NOT pending AND coalesce(category, '') NOT LIKE 'TRANSFER%'
            UNION ALL SELECT date_trunc('week', occurred_on::timestamptz)::date, amount FROM ledger_entries WHERE organization_id = org AND NOT banked AND direction = 'out'
            UNION ALL SELECT date_trunc('week', coalesce(paid_at, created_at))::date, amount FROM team_payments WHERE organization_id = org AND NOT banked AND status = 'paid') x GROUP BY 1)
  SELECT jsonb_agg(jsonb_build_object(
    'week', w.start, 'evaluations', coalesce(ev.n, 0), 'proposalsSent', coalesce(sent.n, 0), 'sentValue', coalesce(sent.v, 0),
    'won', coalesce(won.n, 0), 'wonValue', coalesce(won.v, 0), 'lost', coalesce(lost.n, 0),
    'completed', coalesce(done.n, 0), 'completedValue', coalesce(done.v, 0),
    'cashIn', coalesce(cin.v, 0), 'cashOut', coalesce(cout.v, 0)) ORDER BY w.start)
  INTO weeks
  FROM w LEFT JOIN ev ON ev.wk = w.start LEFT JOIN sent ON sent.wk = w.start LEFT JOIN won ON won.wk = w.start
  LEFT JOIN lost ON lost.wk = w.start LEFT JOIN done ON done.wk = w.start LEFT JOIN cin ON cin.wk = w.start LEFT JOIN cout ON cout.wk = w.start;

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
    'printCostPerPiece', (SELECT eddm_print_cost_per_piece FROM organizations WHERE id = org),
    'bankLinked', banked,
    'bankCash', CASE WHEN banked THEN bank_cash(org) END,
    'bankAt', (SELECT max(balance_at) FROM bank_accounts WHERE organization_id = org AND include),
    'bankName', (SELECT string_agg(DISTINCT institution_name, ', ') FROM bank_links WHERE organization_id = org),
    'bankNeedsRelink', EXISTS (SELECT 1 FROM bank_links WHERE organization_id = org AND status <> 'ok')
  ) INTO cash_j;

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

-- Anything cached by somebody who could not see the whole business is wrong.
SELECT public.summary_refresh(id, 'ops_pulse') FROM public.organizations;

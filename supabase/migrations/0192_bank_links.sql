-- The bank, read rather than typed.
--
-- A linked bank (through Plaid: FNB and most others) gives the pulse the
-- cash on hand and every dollar in and out, so nobody enters a balance
-- and the cash signal is always this morning's. The link's token lets the
-- app read the account, so it lives in a table nothing but the server can
-- read; the balances and transactions are ordinary rows.

CREATE TABLE IF NOT EXISTS public.bank_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  institution_id TEXT,
  institution_name TEXT,
  -- Where the transaction sync got to; null means from the beginning.
  cursor TEXT,
  -- ok | needs_relink | error
  status TEXT NOT NULL DEFAULT 'ok',
  last_error TEXT,
  last_synced_at TIMESTAMPTZ,
  linked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_links_org_idx ON public.bank_links (organization_id);
-- No policies: only the service role, which bypasses row security, reads
-- the token. Everything the office sees comes through bank_status below.
ALTER TABLE public.bank_links ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  link_id UUID NOT NULL REFERENCES public.bank_links(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL UNIQUE,
  name TEXT,
  official_name TEXT,
  mask TEXT,
  -- depository | credit | loan | investment | other, and checking, savings...
  type TEXT,
  subtype TEXT,
  current_balance NUMERIC,
  available_balance NUMERIC,
  currency TEXT,
  balance_at TIMESTAMPTZ,
  -- Whether this account counts as the business's cash. Checking and
  -- savings do; a credit card or a loan does not.
  include BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_accounts_org_idx ON public.bank_accounts (organization_id);

CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL UNIQUE,
  -- As the bank reports it: positive is money out, negative is money in.
  amount NUMERIC NOT NULL,
  posted_on DATE NOT NULL,
  name TEXT,
  merchant TEXT,
  -- Plaid's primary category: INCOME, TRANSFER_IN, LOAN_PAYMENTS, ...
  category TEXT,
  pending BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_transactions_org_date_idx ON public.bank_transactions (organization_id, posted_on DESC);

-- The cash in the bank: the available balance of every account that counts.
CREATE OR REPLACE FUNCTION public.bank_cash(org UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT sum(coalesce(available_balance, current_balance)) FROM bank_accounts WHERE organization_id = org AND include;
$$;

-- What the office may see of the link: the bank, the accounts and their
-- balances, when they were last read, and whether the login needs redoing.
-- Never the token.
CREATE OR REPLACE FUNCTION public.bank_status(org UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'linked', EXISTS (SELECT 1 FROM bank_links WHERE organization_id = org),
    'cash', bank_cash(org),
    'links', coalesce((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'institution', l.institution_name, 'status', l.status, 'lastError', l.last_error,
        'lastSyncedAt', l.last_synced_at, 'linkedAt', l.created_at) ORDER BY l.created_at) FROM bank_links l WHERE l.organization_id = org), '[]'::jsonb),
    'accounts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'accountId', a.account_id, 'linkId', a.link_id, 'name', a.name, 'mask', a.mask, 'type', a.type, 'subtype', a.subtype,
        'current', a.current_balance, 'available', a.available_balance, 'balanceAt', a.balance_at, 'include', a.include) ORDER BY a.include DESC, a.name)
      FROM bank_accounts a WHERE a.organization_id = org), '[]'::jsonb),
    'transactions30', (SELECT count(*) FROM bank_transactions t WHERE t.organization_id = org AND t.posted_on > current_date - 30)
  );
$$;

-- The pulse reads the bank when there is one: the cash is the balance, and
-- the money in and out each week is what the bank says moved, transfers
-- between the business's own accounts left out.
CREATE OR REPLACE FUNCTION public.ops_pulse(org UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  week0 DATE := date_trunc('week', now())::date;
  since DATE; weeks JSONB; now_j JSONB; cash_j JSONB; levers JSONB; plays_j JSONB; banked BOOLEAN;
BEGIN
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

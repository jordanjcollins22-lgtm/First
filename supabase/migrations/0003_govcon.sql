-- Government contracting pipeline ("win as prime, sub it out").
-- Opportunity -> RFQs to local subs -> Quotes -> Bid (priced proposal).
-- Written by unattended cron jobs via the service-role key; read and
-- approved by humans in the /govcon dashboard.

-- ============================================================
-- govcon_settings: single row of company profile overrides
-- ============================================================
create table if not exists govcon_settings (
  id integer primary key default 1 check (id = 1),
  profile jsonb not null default '{}',
  company jsonb not null default '{}', -- name, uei, cage, address, contact, email, phone
  state jsonb not null default '{}',   -- pipeline bookkeeping (e.g. last CSV etag)
  updated_at timestamptz not null default now()
);
insert into govcon_settings (id) values (1) on conflict (id) do nothing;

-- ============================================================
-- govcon_opportunities
-- ============================================================
create table if not exists govcon_opportunities (
  id uuid primary key default gen_random_uuid(),
  -- agency + solicitation number (amendments collapse onto one row)
  opportunity_key text not null unique,
  notice_id text not null,
  source text not null,
  notice_type text not null,
  title text not null,
  solicitation_number text,
  agency text,
  office text,
  naics_code text,
  psc_code text,
  set_aside text not null default 'none',
  set_aside_label text,
  posted_date timestamptz,
  response_deadline timestamptz,
  pop_city text,
  pop_state text,
  pop_zip text,
  pop_country text,
  points_of_contact jsonb not null default '[]',
  description text,
  url text,
  estimated_value numeric,
  trade text,
  score integer not null default 0,
  recommendation text not null default 'no_bid' check (recommendation in ('bid', 'maybe', 'no_bid')),
  score_detail jsonb not null default '{}',
  subcontracting jsonb not null default '{}',
  status text not null default 'new' check (status in (
    'new',              -- scored, waiting for document analysis
    'sourcing',         -- analyzed; finding subs + sending RFQs
    'awaiting_quotes',  -- RFQs out
    'ready',            -- bid priced + proposal drafted, waiting for human approval
    'submitted',
    'won',
    'lost',
    'no_bid',
    'expired'
  )),
  status_reason text,
  analysis jsonb,          -- SolicitationAnalysis from Claude
  attachments jsonb not null default '[]',
  comparables jsonb not null default '[]',
  price_anchor jsonb,
  analyzed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists govcon_opps_status_idx on govcon_opportunities(status, score desc);
create index if not exists govcon_opps_deadline_idx on govcon_opportunities(response_deadline);
create index if not exists govcon_opps_solnum_idx on govcon_opportunities(solicitation_number);

-- ============================================================
-- govcon_subcontractors: local businesses we've found or worked with
-- ============================================================
create table if not exists govcon_subcontractors (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique, -- normalized name + state
  name text not null,
  email text,
  phone text,
  website text,
  address text,
  city text,
  state text,
  zip text,
  rating numeric,
  review_count integer,
  place_id text,
  uei text,
  trades text[] not null default '{}',
  source text not null,
  is_small_business boolean,
  past_federal_amount numeric,
  do_not_contact boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists govcon_subs_state_idx on govcon_subcontractors(state);

-- ============================================================
-- govcon_rfqs: one quote request per (opportunity, sub)
-- ============================================================
create table if not exists govcon_rfqs (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references govcon_opportunities(id) on delete cascade,
  subcontractor_id uuid not null references govcon_subcontractors(id) on delete cascade,
  token text not null unique, -- secret for the public quote portal link
  channel text not null default 'email' check (channel in ('email', 'call')),
  status text not null default 'queued' check (status in (
    'queued', 'sent', 'viewed', 'quoted', 'declined', 'no_response', 'failed', 'called'
  )),
  quote_due_at timestamptz,
  sent_at timestamptz,
  viewed_at timestamptz,
  followups integer not null default 0,
  last_followup_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (opportunity_id, subcontractor_id)
);
create index if not exists govcon_rfqs_status_idx on govcon_rfqs(status);

-- ============================================================
-- govcon_quotes: submitted by subs through the quote portal
-- ============================================================
create table if not exists govcon_quotes (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references govcon_rfqs(id) on delete cascade,
  opportunity_id uuid not null references govcon_opportunities(id) on delete cascade,
  subcontractor_id uuid not null references govcon_subcontractors(id) on delete cascade,
  amount numeric not null,
  notes text,
  lead_time text,
  accepts_net30 boolean,
  down_payment_pct numeric,
  uses_own_employees boolean,
  is_small_business boolean,
  uei text,
  contact_name text,
  contact_email text,
  contact_phone text,
  references_text text,
  file_path text,
  compliance jsonb, -- QuoteCheck from Claude
  created_at timestamptz not null default now()
);
create index if not exists govcon_quotes_opp_idx on govcon_quotes(opportunity_id);

-- ============================================================
-- govcon_bids: the priced proposal we (would) submit
-- ============================================================
create table if not exists govcon_bids (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null unique references govcon_opportunities(id) on delete cascade,
  quote_id uuid references govcon_quotes(id) on delete set null,
  sub_cost numeric not null,
  price numeric not null,
  markup numeric not null,
  pricing jsonb not null default '{}',
  proposal jsonb, -- ProposalDraft from Claude
  compliance_check jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'approved', 'submitted', 'won', 'lost')),
  submitted_at timestamptz,
  award_amount numeric,
  awardee text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- govcon_events: human-readable activity log (what the robot did)
-- ============================================================
create table if not exists govcon_events (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references govcon_opportunities(id) on delete cascade,
  kind text not null,
  message text not null,
  data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists govcon_events_opp_idx on govcon_events(opportunity_id, created_at desc);
create index if not exists govcon_events_created_idx on govcon_events(created_at desc);

-- ============================================================
-- govcon_runs: one row per cron invocation
-- ============================================================
create table if not exists govcon_runs (
  id uuid primary key default gen_random_uuid(),
  stage text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  stats jsonb not null default '{}',
  error text
);

-- updated_at triggers (set_updated_at() is defined in 0001_init.sql)
do $$
declare
  t text;
begin
  foreach t in array array[
    'govcon_settings', 'govcon_opportunities', 'govcon_subcontractors', 'govcon_rfqs', 'govcon_bids'
  ]
  loop
    execute format(
      'drop trigger if exists set_updated_at on %I; create trigger set_updated_at before update on %I for each row execute function set_updated_at();',
      t, t
    );
  end loop;
end $$;

-- RLS: same internal-tool posture as the rest of the app. The cron uses the
-- service-role key (bypasses RLS); the public quote portal goes through
-- server actions that check the RFQ token, never direct table access.
do $$
declare
  t text;
begin
  foreach t in array array[
    'govcon_settings', 'govcon_opportunities', 'govcon_subcontractors', 'govcon_rfqs',
    'govcon_quotes', 'govcon_bids', 'govcon_events', 'govcon_runs'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'drop policy if exists "authenticated_full_access" on %I; create policy "authenticated_full_access" on %I for all to authenticated using (true) with check (true);',
      t, t
    );
  end loop;
end $$;

-- Private bucket for subcontractor quote PDFs.
insert into storage.buckets (id, name, public)
values ('govcon-quotes', 'govcon-quotes', false)
on conflict (id) do nothing;

drop policy if exists "authenticated_read_govcon_quotes" on storage.objects;
create policy "authenticated_read_govcon_quotes"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'govcon-quotes');

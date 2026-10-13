-- Finance and the integrations behind it: invoicing and collections
-- settings, autopay per client, the one-way QuickBooks Online sync, and
-- payroll exports. Additive only.

-- One row per business: how invoicing, collections, payroll and the QBO
-- sync behave. Every automation here starts off, and records when it was
-- first switched on so it only ever acts on what came after.
create table if not exists public.finance_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  -- Card or bank on file, charged automatically, for recurring clients.
  autopay_enabled boolean not null default false,
  autopay_started_at timestamptz,
  -- Offer US bank (ACH) next to card on invoices: 0.8% capped at $5.
  offer_ach boolean not null default true,
  -- Late fees: off by default. Maryland limits interest and fees on consumer
  -- contracts, so the owner confirms the terms before switching on.
  late_fee_enabled boolean not null default false,
  late_fee_started_at timestamptz,
  late_fee_kind text not null default 'percent' check (late_fee_kind in ('percent', 'flat')),
  late_fee_amount numeric not null default 1.5,
  late_fee_grace_days integer not null default 15,
  -- Collections target: days sales outstanding.
  dso_target_days integer not null default 30,
  -- Payroll export. Which provider and where it is sent live on the
  -- "payroll" integration; this is each person's id at that provider:
  -- profile id -> Gusto employee id or ADP file number.
  payroll_ids jsonb not null default '{}'::jsonb,
  -- One-way QuickBooks Online sync.
  qbo_sync_enabled boolean not null default false,
  qbo_sync_started_at timestamptz,
  -- Only records on or after this are pushed; defaults to when the sync was
  -- switched on. An earlier date is the owner deliberately backfilling.
  qbo_sync_from timestamptz,
  -- Scorecard targets the owner can override, by metric key.
  targets jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);
alter table public.finance_settings enable row level security;
drop policy if exists finance_settings_own_org on public.finance_settings;
create policy finance_settings_own_org on public.finance_settings
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- Autopay per client: whether they are on it, and what Stripe holds for them.
-- No card numbers: only the type and last four Stripe reports.
create table if not exists public.customer_autopay (
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  enabled boolean not null default true,
  stripe_customer_id text,
  setup_session_id text,
  setup_url text,
  setup_requested_at timestamptz,
  payment_method_type text,
  payment_method_last4 text,
  confirmed_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (organization_id, customer_id)
);
alter table public.customer_autopay enable row level security;
drop policy if exists customer_autopay_own_org on public.customer_autopay;
create policy customer_autopay_own_org on public.customer_autopay
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- Each autopay charge attempt, once per Stripe invoice: running the charge
-- twice can never take the money twice.
create table if not exists public.autopay_charges (
  organization_id uuid not null references organizations(id) on delete cascade,
  stripe_invoice_id text not null,
  customer_id uuid references customers(id) on delete set null,
  invoice_id uuid references invoices(id) on delete set null,
  amount_cents integer not null default 0,
  status text not null default 'claimed' check (status in ('claimed', 'paid', 'failed')),
  error text,
  attempted_at timestamptz not null default now(),
  primary key (organization_id, stripe_invoice_id)
);
alter table public.autopay_charges enable row level security;
drop policy if exists autopay_charges_own_org on public.autopay_charges;
create policy autopay_charges_own_org on public.autopay_charges
  for select to authenticated
  using (organization_id = (select current_org_id()));

-- What has been pushed to QuickBooks: one row per app record, so a record is
-- created there once and only updated after that.
create table if not exists public.qbo_sync_map (
  organization_id uuid not null references organizations(id) on delete cascade,
  entity text not null check (entity in ('customer', 'invoice', 'payment')),
  local_id text not null,
  qbo_id text,
  sync_token text,
  -- A fingerprint of what was sent, so an unchanged record isn't resent.
  content_hash text,
  synced_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (organization_id, entity, local_id)
);
alter table public.qbo_sync_map enable row level security;
drop policy if exists qbo_sync_map_own_org on public.qbo_sync_map;
create policy qbo_sync_map_own_org on public.qbo_sync_map
  for select to authenticated
  using (organization_id = (select current_org_id()));

create table if not exists public.qbo_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trigger text not null default 'cron',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  pushed jsonb not null default '{}'::jsonb,
  failed integer not null default 0,
  summary text
);
create index if not exists qbo_sync_runs_org_started on public.qbo_sync_runs (organization_id, started_at desc);
alter table public.qbo_sync_runs enable row level security;
drop policy if exists qbo_sync_runs_own_org on public.qbo_sync_runs;
create policy qbo_sync_runs_own_org on public.qbo_sync_runs
  for select to authenticated
  using (organization_id = (select current_org_id()));

-- Each payroll week sent to the payroll provider, so "Send" twice sends once.
create table if not exists public.payroll_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  week_start date not null,
  format text not null,
  sent_to text not null,
  people integer not null default 0,
  total_hours numeric not null default 0,
  total_commission numeric not null default 0,
  sent_at timestamptz,
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'failed')),
  error text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, week_start, format, sent_to)
);
alter table public.payroll_exports enable row level security;
drop policy if exists payroll_exports_own_org on public.payroll_exports;
create policy payroll_exports_own_org on public.payroll_exports
  for select to authenticated
  using (organization_id = (select current_org_id()));

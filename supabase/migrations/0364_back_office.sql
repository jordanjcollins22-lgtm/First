-- Back office: commissions that accrue themselves, the Maryland compliance
-- calendar, certificates of insurance, new-hire checklists.
--
-- Everything here is additive. Nothing existing is altered or dropped, and
-- every automation starts switched off: each switch records the moment it
-- was first turned on, and the automation only ever acts on what happened
-- after that moment, so turning one on never sweeps up the backlog.

-- ---------------------------------------------------------------------------
-- Settings: one row per business.
-- ---------------------------------------------------------------------------
create table if not exists public.back_office_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,

  -- Commission accrual on paid invoices, and the weekly payout statement.
  commission_accrual_on boolean not null default false,
  commission_accrual_started_at timestamptz,
  -- The rate a share pays when nobody has set one for that person.
  default_account_manager_pct numeric(5,2) not null default 7,
  default_evaluator_pct numeric(5,2) not null default 4,
  default_affiliate_pct numeric(5,2) not null default 4,
  -- Hold-back: pay part on collection, the rest once the job closes at margin.
  commission_holdback_on boolean not null default false,
  holdback_collect_pct numeric(5,2) not null default 50 check (holdback_collect_pct between 0 and 100),
  holdback_margin_pct numeric(5,2) not null default 40,
  -- What an hour of crew costs, for the margin test. Dollars.
  holdback_crew_cost_per_hour numeric(8,2) not null default 35,

  -- Compliance reminders to the owner at 60/30/7 days, and overdue alerts.
  compliance_reminders_on boolean not null default false,
  compliance_reminders_started_at timestamptz,
  reminder_days int[] not null default '{60,30,7}',

  -- New-hire checklists created on hire.
  onboarding_on boolean not null default false,
  onboarding_started_at timestamptz,

  -- The Maryland fertilizer blackout check on scheduling and proposals.
  -- A check rather than an automation (it sends nothing), so it starts on.
  fertilizer_guard_on boolean not null default true,

  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.back_office_settings enable row level security;
drop policy if exists back_office_settings_own_org on public.back_office_settings;
create policy back_office_settings_own_org on public.back_office_settings
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- Commissions
-- ---------------------------------------------------------------------------

-- A person's rate on file for one share of the pool. Absent means the
-- business default in back_office_settings. Kept apart from
-- profiles.commission_pct, which is an account manager's pre-pool deal.
create table if not exists public.commission_rates (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('account_manager', 'evaluator', 'affiliate')),
  pct numeric(5,2) not null check (pct >= 0 and pct <= 100),
  set_by uuid references public.profiles(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (profile_id, role)
);
alter table public.commission_rates enable row level security;
drop policy if exists commission_rates_admin on public.commission_rates;
create policy commission_rates_admin on public.commission_rates
  for all to authenticated
  using (organization_id = (select current_org_id()) and (select is_admin()))
  with check (organization_id = (select current_org_id()) and (select is_admin()));

-- One weekly payout: the single total the owner approves.
create table if not exists public.commission_payout_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  total numeric(12,2) not null default 0,
  people int not null default 0,
  status text not null default 'awaiting_approval' check (status in ('awaiting_approval', 'approved', 'void')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, week_start)
);
alter table public.commission_payout_batches enable row level security;
drop policy if exists commission_payout_batches_admin on public.commission_payout_batches;
create policy commission_payout_batches_admin on public.commission_payout_batches
  for all to authenticated
  using (organization_id = (select current_org_id()) and (select is_admin()))
  with check (organization_id = (select current_org_id()) and (select is_admin()));

-- One person's statement inside a batch: what they get, line by line.
create table if not exists public.commission_statements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null references public.commission_payout_batches(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  total numeric(12,2) not null default 0,
  -- [{job_id, customer, role, portion, amount}]
  lines jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (batch_id, profile_id)
);
create index if not exists commission_statements_profile on public.commission_statements (profile_id, created_at desc);
alter table public.commission_statements enable row level security;
drop policy if exists commission_statements_admin on public.commission_statements;
create policy commission_statements_admin on public.commission_statements
  for all to authenticated
  using (organization_id = (select current_org_id()) and (select is_admin()))
  with check (organization_id = (select current_org_id()) and (select is_admin()));

-- Commission earned on one payment, per person and share. Written by the
-- Stripe webhook and the daily sweep with the service role; unique per
-- payment, person, share and portion, so a retried webhook adds nothing.
create table if not exists public.commission_accruals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  role text not null check (role in ('account_manager', 'evaluator', 'affiliate')),
  -- 'stripe_invoice:<id>' or 'payment:<uuid>' or 'invoice:<uuid>'.
  source_key text not null,
  base_amount numeric(12,2) not null,
  pct numeric(5,2) not null,
  amount numeric(12,2) not null,
  -- 'collection' pays on the money coming in (subject to pay_on_collect);
  -- 'holdback' pays once the job closes at margin.
  portion text not null default 'collection' check (portion in ('collection', 'holdback')),
  -- True when this portion is payable as soon as the money is in. False
  -- means it waits for the job's sign-off, as an account manager's share
  -- always has.
  pay_on_collect boolean not null default false,
  status text not null default 'accrued' check (status in ('accrued', 'batched', 'paid', 'void')),
  hold_reason text,
  batch_id uuid references public.commission_payout_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_key, profile_id, role, portion)
);
create index if not exists commission_accruals_open on public.commission_accruals (organization_id, status, created_at);
create index if not exists commission_accruals_job on public.commission_accruals (job_id);
create index if not exists commission_accruals_batch on public.commission_accruals (batch_id);
alter table public.commission_accruals enable row level security;
drop policy if exists commission_accruals_admin on public.commission_accruals;
create policy commission_accruals_admin on public.commission_accruals
  for all to authenticated
  using (organization_id = (select current_org_id()) and (select is_admin()))
  with check (organization_id = (select current_org_id()) and (select is_admin()));

-- ---------------------------------------------------------------------------
-- Compliance calendar
-- ---------------------------------------------------------------------------
create table if not exists public.compliance_obligations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  title text not null check (length(btrim(title)) > 0),
  -- Whose or which: a person's name, a truck, a policy.
  holder text,
  profile_id uuid references public.profiles(id) on delete set null,
  fleet_asset_id uuid references public.fleet_assets(id) on delete set null,
  due_on date,
  recurrence text not null default 'annual' check (recurrence in ('annual', 'biennial', 'quarterly', 'none')),
  -- Seeded defaults are false: "confirm the date".
  date_confirmed boolean not null default false,
  -- Off for things the business may not have: an MHIC license, H-2B.
  active boolean not null default true,
  -- Applicator recertification credits.
  credits_required int,
  credits_earned int,
  -- Insurance details, for the policies and the COI.
  carrier text,
  policy_number text,
  coverage_limits text,
  -- The certificate or license itself, in the compliance-docs bucket.
  document_path text,
  notes text,
  source_url text,
  last_done_on date,
  seed_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, seed_key)
);
create index if not exists compliance_obligations_due on public.compliance_obligations (organization_id, active, due_on);
alter table public.compliance_obligations enable row level security;
drop policy if exists compliance_obligations_own_org on public.compliance_obligations;
create policy compliance_obligations_own_org on public.compliance_obligations
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- Certificates of insurance generated for clients who asked for one.
create table if not exists public.client_cois (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  holder_name text not null,
  holder_address text,
  additional_insured boolean not null default false,
  file_path text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_to text
);
create index if not exists client_cois_customer on public.client_cois (customer_id, created_at desc);
alter table public.client_cois enable row level security;
drop policy if exists client_cois_own_org on public.client_cois;
create policy client_cois_own_org on public.client_cois
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- New-hire checklists
-- ---------------------------------------------------------------------------
create table if not exists public.onboarding_checklists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  applicant_id uuid unique references public.job_applicants(id) on delete set null,
  profile_id uuid unique references public.profiles(id) on delete set null,
  person_name text not null,
  email text,
  position text,
  start_date date not null,
  handles_pesticides boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists onboarding_checklists_org on public.onboarding_checklists (organization_id, created_at desc);
alter table public.onboarding_checklists enable row level security;
drop policy if exists onboarding_checklists_admin on public.onboarding_checklists;
create policy onboarding_checklists_admin on public.onboarding_checklists
  for all to authenticated
  using (organization_id = (select current_org_id()) and (select is_admin()))
  with check (organization_id = (select current_org_id()) and (select is_admin()));

create table if not exists public.onboarding_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  checklist_id uuid not null references public.onboarding_checklists(id) on delete cascade,
  key text not null,
  label text not null,
  due_on date not null,
  done_at timestamptz,
  done_by uuid references public.profiles(id) on delete set null,
  waived boolean not null default false,
  document_path text,
  unique (checklist_id, key)
);
create index if not exists onboarding_items_open on public.onboarding_items (organization_id, done_at, due_on);
alter table public.onboarding_items enable row level security;
drop policy if exists onboarding_items_admin on public.onboarding_items;
create policy onboarding_items_admin on public.onboarding_items
  for all to authenticated
  using (organization_id = (select current_org_id()) and (select is_admin()))
  with check (organization_id = (select current_org_id()) and (select is_admin()));

-- ---------------------------------------------------------------------------
-- Storage: private, no policies. Every read and write goes through a signed
-- link minted by the server after it has checked the caller is owner-level.
-- An I-9 or an insurance certificate is one guessed URL from a leak in a
-- public bucket.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('compliance-docs', 'compliance-docs', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('hr-docs', 'hr-docs', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';

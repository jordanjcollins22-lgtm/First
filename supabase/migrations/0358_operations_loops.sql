-- Closing the operations loops.
--
-- Work days, job costing and the client sign-off all start on their own and
-- end only when somebody remembers to tick something. This adds what the
-- automations need to end them instead: a switch and a start time for each,
-- a record of when and how a work day closed, the job-cost snapshot, the
-- completion chain's progress (and the hook the review request watches), the
-- morning check-in alerts with their escalation, the weekly crew bonus, and
-- the auto-placement log.
--
-- Additive only. Nothing here changes or removes an existing row. Every
-- automation reads its own started_at and touches nothing older, so the
-- thirteen past "scheduled" sessions stay exactly as they are until a person
-- reviews them.

-- ---------------------------------------------------------------------------
-- 1. The switches
-- ---------------------------------------------------------------------------

create table if not exists public.ops_autopilot_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,

  auto_close_enabled boolean not null default true,
  auto_close_started_at timestamptz,
  -- 21:00 business time: a work day still open then needs a person.
  unclosed_cutoff_minutes integer not null default 1260
    check (unclosed_cutoff_minutes between 720 and 1439),

  completion_chain_enabled boolean not null default true,
  completion_chain_started_at timestamptz,
  invoice_after_client_approval boolean not null default true,
  signoff_overdue_hours integer not null default 72 check (signoff_overdue_hours > 0),
  over_budget_pct integer not null default 10 check (over_budget_pct between 0 and 100),
  labor_burden_pct numeric not null default 0 check (labor_burden_pct between 0 and 100),

  checkin_lead_first_enabled boolean not null default true,
  checkin_started_at timestamptz,
  checkin_escalate_minutes integer not null default 30 check (checkin_escalate_minutes between 5 and 240),

  auto_place_enabled boolean not null default true,
  auto_place_started_at timestamptz,
  auto_place_min_notice_days integer not null default 2 check (auto_place_min_notice_days between 1 and 14),
  auto_place_daily_cap integer not null default 5 check (auto_place_daily_cap between 0 and 50),

  crew_bonus_enabled boolean not null default false,
  crew_bonus_started_at timestamptz,
  crew_bonus_per_member_cents integer not null default 5000 check (crew_bonus_per_member_cents >= 0),

  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.ops_autopilot_settings enable row level security;
drop policy if exists ops_autopilot_settings_own_org on public.ops_autopilot_settings;
create policy ops_autopilot_settings_own_org on public.ops_autopilot_settings
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- 2. How a work day closed
-- ---------------------------------------------------------------------------

-- updated_at changes for any edit; this is the moment it was closed, by whom
-- (null for the automation) and how: the crew's tap, a person, or the
-- one-off review of the backlog.
alter table public.job_work_sessions add column if not exists closed_at timestamptz;
alter table public.job_work_sessions add column if not exists closed_by uuid references public.profiles(id) on delete set null;
alter table public.job_work_sessions add column if not exists close_source text
  check (close_source is null or close_source in ('crew_finished', 'lead', 'backlog_review'));

-- An exception the app raised itself, rather than somebody in the field.
-- Named so one automation never raises the same thing twice for one visit.
alter table public.job_exceptions add column if not exists raised_by text;
create unique index if not exists job_exceptions_raised_once_idx
  on public.job_exceptions (work_session_id, raised_by)
  where raised_by is not null and work_session_id is not null;

-- ---------------------------------------------------------------------------
-- 3. What the job really cost
-- ---------------------------------------------------------------------------

create table if not exists public.job_cost_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  computed_at timestamptz not null default now(),
  -- Taken after the job was completed. A snapshot from before completion is
  -- retaken once when it completes.
  final boolean not null default false,

  revenue_cents bigint not null default 0,
  budget_hours numeric,
  actual_hours numeric not null default 0,
  travel_hours numeric not null default 0,
  onsite_hours numeric not null default 0,
  efficiency_pct numeric,
  hours_variance_pct numeric,
  over_budget boolean not null default false,

  labor_cents bigint not null default 0,
  materials_cents bigint not null default 0,
  other_cents bigint not null default 0,
  gross_margin_cents bigint not null default 0,
  gross_margin_pct numeric,
  revenue_per_crew_hour_cents bigint,

  -- Who worked it and for how long, and anything the numbers rest on that a
  -- reader should know (estimated pay rates, unclosed stops).
  people jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb
);
create index if not exists job_cost_snapshots_org_idx on public.job_cost_snapshots (organization_id, computed_at desc);

-- Pay and margin: the same audience the ledger has.
alter table public.job_cost_snapshots enable row level security;
drop policy if exists job_cost_snapshots_office on public.job_cost_snapshots;
create policy job_cost_snapshots_office on public.job_cost_snapshots
  for select to authenticated
  using (
    organization_id = (select current_org_id())
    and exists (
      select 1 from public.profile_roles pr
      where pr.profile_id = (select auth.uid()) and pr.role_name in ('admin', 'owner', 'overhead')
    )
  );

-- ---------------------------------------------------------------------------
-- 4. The completion chain, and the review-request hook
-- ---------------------------------------------------------------------------

create table if not exists public.job_completion_chain (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  trigger text not null check (trigger in ('job_completed', 'sessions_closed')),
  triggered_at timestamptz not null default now(),
  stage text,
  -- Something a person has to do, for the exceptions strip. Null when nothing.
  exception text,

  signoff_review_id uuid,
  signoff_requested_at timestamptz,
  lead_nudged_at timestamptz,

  invoice_state text check (invoice_state is null or invoice_state in ('raised', 'existing', 'billed_elsewhere', 'not_billable', 'not_connected', 'failed')),
  invoice_note text,
  invoiced_at timestamptz,

  cost_snapshot_at timestamptz,

  -- THE HOOK. Set once, when the client has approved the before & afters, the
  -- job was completed without a client review, or the invoice was paid.
  -- Workstream A2's review request watches for rows where this is set.
  review_ready_at timestamptz,
  review_ready_reason text check (review_ready_reason is null or review_ready_reason in ('client_approved', 'job_completed', 'invoice_paid')),

  updated_at timestamptz not null default now()
);
create index if not exists job_completion_chain_review_ready_idx
  on public.job_completion_chain (organization_id, review_ready_at)
  where review_ready_at is not null;

alter table public.job_completion_chain enable row level security;
drop policy if exists job_completion_chain_own_org on public.job_completion_chain;
create policy job_completion_chain_own_org on public.job_completion_chain
  for select to authenticated
  using (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- 5. Morning check-in alerts: the lead first, the owner if nobody answers
-- ---------------------------------------------------------------------------

create table if not exists public.crew_checkin_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  day date not null,
  -- The person who has not opened the app.
  profile_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  lead_id uuid references public.profiles(id) on delete set null,
  -- In the text, so the lead can say "on it" with one tap and no sign-in.
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  alerted_at timestamptz not null default now(),
  alerted_to uuid[] not null default '{}',
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles(id) on delete set null,
  escalated_at timestamptz,
  -- They turned up in the app after all.
  resolved_at timestamptz,
  unique (organization_id, day, profile_id)
);

alter table public.crew_checkin_alerts enable row level security;
drop policy if exists crew_checkin_alerts_own_org on public.crew_checkin_alerts;
create policy crew_checkin_alerts_own_org on public.crew_checkin_alerts
  for select to authenticated
  using (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- 6. The weekly crew bonus
-- ---------------------------------------------------------------------------

create table if not exists public.crew_bonus_weeks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  week_start date not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  job_ids uuid[] not null default '{}',
  budget_hours numeric not null default 0,
  actual_hours numeric not null default 0,
  amount_cents integer not null default 0,
  status text not null default 'accrued' check (status in ('accrued', 'approved', 'paid', 'void')),
  reason text,
  computed_at timestamptz not null default now(),
  unique (organization_id, week_start, profile_id)
);

alter table public.crew_bonus_weeks enable row level security;
drop policy if exists crew_bonus_weeks_read on public.crew_bonus_weeks;
create policy crew_bonus_weeks_read on public.crew_bonus_weeks
  for select to authenticated
  using (
    organization_id = (select current_org_id())
    and (
      profile_id = (select auth.uid())
      or exists (
        select 1 from public.profile_roles pr
        where pr.profile_id = (select auth.uid()) and pr.role_name in ('admin', 'owner', 'overhead')
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 7. What auto-placement did, and what it held
-- ---------------------------------------------------------------------------

create table if not exists public.auto_placements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  status text not null check (status in ('placed', 'held', 'dismissed')),
  session_id uuid references public.job_work_sessions(id) on delete set null,
  placed_on date,
  crew uuid[] not null default '{}',
  because jsonb not null default '[]'::jsonb,
  held_reason text,
  client_notice text,
  decided_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists auto_placements_org_idx on public.auto_placements (organization_id, status);

alter table public.auto_placements enable row level security;
drop policy if exists auto_placements_own_org on public.auto_placements;
create policy auto_placements_own_org on public.auto_placements
  for select to authenticated
  using (organization_id = (select current_org_id()));

notify pgrst, 'reload schema';

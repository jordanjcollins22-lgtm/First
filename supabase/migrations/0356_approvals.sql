-- One approval queue, a policy per kind of email, decline reasons, the
-- Monday digest's switch, and the owner's task list.
--
-- Additive only. Nothing here changes what is sent today: the org-wide
-- require_email_approval switch stays the master hold, and while it is on
-- every automatic email is parked exactly as before. The per-kind policy
-- takes over only once the owner switches the master hold off.

-- ---------------------------------------------------------------------------
-- Held emails: why one was declined, and whether it goes on its own.
-- ---------------------------------------------------------------------------

-- A held email of a low-risk kind is sent when nobody has looked at it by
-- auto_send_at, rather than dropped. expires_at keeps its old meaning: after
-- it the email is too late to send at all.
alter table public.outbound_approvals add column if not exists send_on_expiry boolean not null default false;
alter table public.outbound_approvals add column if not exists auto_send_at timestamptz;
-- One tap when the owner says no, so the trigger behind it can be fixed.
alter table public.outbound_approvals add column if not exists decline_reason text
  check (decline_reason is null or decline_reason in ('wrong_person', 'cancelled_booking', 'wording', 'timing', 'other'));
-- Why the app itself closed one unsent: the booking was cancelled, the
-- proposal was already answered, the visit moved.
alter table public.outbound_approvals add column if not exists moot_reason text;

create index if not exists outbound_approvals_auto_send_idx
  on public.outbound_approvals (auto_send_at) where status = 'pending' and send_on_expiry;

-- ---------------------------------------------------------------------------
-- The policy: each kind of automatic email auto-sends, waits, or waits and
-- then sends. A kind with no row follows the built-in default in code
-- (src/lib/approvals/policy.ts), so a new kind never needs a migration.
-- ---------------------------------------------------------------------------
create table if not exists public.email_approval_policy (
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null,
  mode text not null check (mode in ('auto', 'hold', 'hold_then_send')),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null,
  primary key (organization_id, kind)
);
alter table public.email_approval_policy enable row level security;
drop policy if exists email_approval_policy_own_org on public.email_approval_policy;
create policy email_approval_policy_own_org on public.email_approval_policy
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- One row per business: when the per-kind policy started, and the digest.
-- ---------------------------------------------------------------------------
create table if not exists public.approval_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  -- Set the first time the master hold is switched off with the policy in
  -- force. Only emails written after this moment are ever sent on expiry.
  policy_started_at timestamptz,
  -- The Monday digest to the owner. On by default: it only ever goes to
  -- the owner, never to a client, so there is no backlog to blast.
  digest_enabled boolean not null default true,
  digest_started_at timestamptz,
  digest_last_sent_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);
alter table public.approval_settings enable row level security;
drop policy if exists approval_settings_own_org on public.approval_settings;
create policy approval_settings_own_org on public.approval_settings
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- Every "no" from the approval queue, whatever it was: an email, a price, a
-- marketing play, a social post, a property-manager draft, an exception.
-- Read back as the top-reasons report.
-- ---------------------------------------------------------------------------
create table if not exists public.approval_declines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  item_type text not null check (item_type in ('email', 'price', 'play', 'social', 'pm_draft', 'exception')),
  item_id text not null,
  -- The email kind, play kind or exception kind, so reasons group by trigger.
  item_kind text,
  reason text not null check (reason in ('wrong_person', 'cancelled_booking', 'wording', 'timing', 'other')),
  note text,
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz not null default now()
);
create index if not exists approval_declines_org_idx on public.approval_declines (organization_id, decided_at desc);
alter table public.approval_declines enable row level security;
drop policy if exists approval_declines_own_org on public.approval_declines;
create policy approval_declines_own_org on public.approval_declines
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- The owner's task list, shared rather than saved in one browser.
-- ---------------------------------------------------------------------------
create table if not exists public.owner_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Marketing, Sales, Operations, Admin, or Other for the owner's one-offs.
  section text not null default 'Other',
  title text not null check (length(trim(title)) > 0),
  note text,
  status text not null default 'todo'
    check (status in ('todo', 'not_built', 'partly_built', 'in_progress', 'done', 'dropped')),
  position integer not null default 0,
  assigned_to uuid references profiles(id) on delete set null,
  done_at timestamptz,
  done_by uuid references profiles(id) on delete set null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, section, title)
);
create index if not exists owner_tasks_org_idx on public.owner_tasks (organization_id, section, position);
alter table public.owner_tasks enable row level security;
drop policy if exists owner_tasks_own_org on public.owner_tasks;
create policy owner_tasks_own_org on public.owner_tasks
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- Who changed what, so the list is auditable rather than just current.
create table if not exists public.owner_task_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  task_id uuid not null references owner_tasks(id) on delete cascade,
  action text not null,
  from_value text,
  to_value text,
  by_profile uuid references profiles(id) on delete set null,
  at timestamptz not null default now()
);
create index if not exists owner_task_events_task_idx on public.owner_task_events (task_id, at desc);
alter table public.owner_task_events enable row level security;
drop policy if exists owner_task_events_own_org on public.owner_task_events;
create policy owner_task_events_own_org on public.owner_task_events
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

notify pgrst, 'reload schema';

-- The crew's day, as it actually happens.
--
-- A crew member opening the app got the office's view of the business: every
-- job, every stage, every panel. What they need is one question answered —
-- where am I going next — and one button to press when the answer changes.
--
-- Stored as an append-only log rather than a status column, for three reasons.
-- The timings fall out for free (how long at the shop, how long on each stop).
-- A tap is a fact that happened at a time, and overwriting it loses that. And
-- the current state is then derived, so it cannot drift from the record the
-- way a status column drifts from its history.

create table if not exists crew_day_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  profile_id uuid not null references profiles(id) on delete cascade,

  -- The working day this belongs to, in the org's local terms. Kept as its own
  -- column rather than derived from at::date so a crew finishing after
  -- midnight still belongs to the day they started.
  day date not null,

  kind text not null check (kind in (
    'arrived_shop',
    'left_shop',
    'travelling',
    'arrived_job',
    'finished_job',
    'returned_shop'
  )),

  -- Which stop this is about. Null for the shop events, which belong to the
  -- day rather than to any one job.
  job_id uuid references jobs(id) on delete cascade,

  at timestamptz not null default now(),
  -- Where they were when they tapped, when the browser offered it. Best-effort
  -- and never required: a crew member in a dead spot still has to be able to
  -- say they arrived.
  lat double precision,
  lng double precision,
  note text,

  created_at timestamptz not null default now(),

  -- Shop events have no job; job events must have one. A 'finished_job' with
  -- no job is not a partial record, it is a meaningless one.
  constraint crew_day_events_job_presence check (
    (kind in ('arrived_shop', 'left_shop', 'returned_shop') and job_id is null)
    or (kind in ('travelling', 'arrived_job', 'finished_job') and job_id is not null)
  )
);

create index if not exists crew_day_events_person_day_idx
  on crew_day_events(profile_id, day, at);
create index if not exists crew_day_events_org_day_idx
  on crew_day_events(organization_id, day);

alter table crew_day_events enable row level security;

-- A crew member writes their own day and reads their own day. The office reads
-- everybody's, because knowing where the crew is is the entire point of them
-- tapping the buttons — but nobody writes somebody else's day, so the log
-- stays a record of what a person actually said.
drop policy if exists "crew_day_events_own_write" on crew_day_events;
create policy "crew_day_events_own_write" on crew_day_events for all to authenticated
  using (organization_id = current_org_id() and profile_id = auth.uid())
  with check (organization_id = current_org_id() and profile_id = auth.uid());

drop policy if exists "crew_day_events_office_read" on crew_day_events;
create policy "crew_day_events_office_read" on crew_day_events for select to authenticated
  using (
    organization_id = current_org_id()
    and exists (
      select 1 from profile_roles pr
      where pr.profile_id = auth.uid() and pr.role_name in ('admin', 'owner', 'overhead')
    )
  );

-- ---------------------------------------------------------------------------
-- Stop order
-- ---------------------------------------------------------------------------

-- Which house first. Null means "wherever the deterministic order puts it",
-- which is what every existing visit gets — the crew still sees a definite
-- first stop, the office just has not overridden it.
alter table job_work_sessions add column if not exists stop_order integer;

notify pgrst, 'reload schema';

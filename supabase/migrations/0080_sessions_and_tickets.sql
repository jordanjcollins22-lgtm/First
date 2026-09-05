-- Three things a real job needs that the schema could not express.
--
--  1. An evaluation was an instant, not an appointment. No end time meant no
--     length, so two visits could be booked into the same hour and nothing
--     noticed, and nobody could see how long a visit was supposed to take.
--
--  2. Work was one start date and one end date, so a job that pauses — weather,
--     a material back-order, a crew pulled onto something urgent — had to lie
--     about its dates or lose them. Jobs that take three separate visits had
--     nowhere to say so.
--
--  3. Going back to fix something had no record at all. It was either an
--     untracked visit or a second job pretending to be new work, and either
--     way the question "what went wrong, and why did we go back" had no answer.

-- ---------------------------------------------------------------------------
-- 1. Evaluations get an end
-- ---------------------------------------------------------------------------

-- Deliberately nullable rather than backfilled to an invented length: existing
-- rows genuinely do not record how long the visit was, and writing a guess
-- into the database makes a guess indistinguishable from a fact. The app
-- treats a null end as the default visit length for display and overlap.
alter table jobs add column if not exists evaluation_end_date timestamptz;

alter table jobs drop constraint if exists jobs_evaluation_window;
alter table jobs add constraint jobs_evaluation_window check (
  evaluation_end_date is null
  or evaluation_date is null
  or evaluation_end_date > evaluation_date
);

-- ---------------------------------------------------------------------------
-- 2. Work sessions
-- ---------------------------------------------------------------------------

-- A job is now a list of visits. jobs.project_start_date / project_end_date
-- stay as the overall window, maintained by trigger below rather than by hand,
-- so every existing query and the calendar keep working against one truth
-- instead of two that can drift.
create table if not exists job_work_sessions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  organization_id uuid not null references organizations(id),

  starts_on date not null,
  ends_on date not null,

  status text not null default 'scheduled'
    check (status in ('scheduled', 'in_progress', 'paused', 'done', 'cancelled')),

  -- Why this visit exists, and why it stopped. 'paused' without a reason is
  -- the thing everyone forgets by the following week.
  purpose text,
  pause_reason text,

  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint job_work_sessions_order check (ends_on >= starts_on)
);

create index if not exists job_work_sessions_job_idx
  on job_work_sessions(job_id, starts_on);
create index if not exists job_work_sessions_org_idx
  on job_work_sessions(organization_id, starts_on);

drop trigger if exists set_updated_at on job_work_sessions;
create trigger set_updated_at before update on job_work_sessions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Tickets
-- ---------------------------------------------------------------------------

-- Something to go back for: a callback, a warranty fix, a snag. Kept against
-- the original job rather than opened as a new one, so the history of a
-- property reads as what actually happened.
create table if not exists job_tickets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  organization_id uuid not null references organizations(id),

  title text not null,
  -- What it was, and why it happened. Two fields on purpose: the fault and the
  -- cause are different questions, and collapsing them into one box means the
  -- cause is the half that never gets written down.
  detail text,
  cause text check (cause in (
    'workmanship', 'material_failure', 'design', 'weather', 'client_change', 'unknown'
  )),

  severity text not null default 'normal' check (severity in ('low', 'normal', 'urgent')),
  status text not null default 'open' check (status in ('open', 'scheduled', 'resolved', 'closed')),

  -- Whether the business ate the cost. The question every callback ends on.
  billable boolean not null default false,

  resolution text,
  resolved_at timestamptz,

  opened_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_tickets_job_idx on job_tickets(job_id, created_at);
create index if not exists job_tickets_org_status_idx on job_tickets(organization_id, status);

drop trigger if exists set_updated_at on job_tickets;
create trigger set_updated_at before update on job_tickets
  for each row execute function set_updated_at();

-- A visit can exist to work a ticket. Nullable: most visits are just the work.
alter table job_work_sessions
  add column if not exists ticket_id uuid references job_tickets(id) on delete set null;

create index if not exists job_work_sessions_ticket_idx
  on job_work_sessions(ticket_id) where ticket_id is not null;

-- ---------------------------------------------------------------------------
-- Keeping the job's window in step with its sessions
-- ---------------------------------------------------------------------------

-- The columns become a projection of the sessions rather than a second place
-- to record the same fact. Cancelled sessions are excluded — a called-off
-- visit should not stretch the job's window.
create or replace function sync_job_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.job_id, old.job_id);
begin
  update jobs j
  set project_start_date = w.min_start,
      project_end_date = w.max_end
  from (
    select
      min(starts_on) as min_start,
      max(ends_on) as max_end
    from job_work_sessions
    where job_id = target and status <> 'cancelled'
  ) w
  where j.id = target;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_job_window_ins on job_work_sessions;
create trigger sync_job_window_ins after insert or update or delete on job_work_sessions
  for each row execute function sync_job_window();

-- Every job that already had a window becomes one session, so nothing on the
-- calendar disappears the moment sessions become the source of truth.
insert into job_work_sessions (job_id, organization_id, starts_on, ends_on, status, purpose)
select
  j.id,
  c.organization_id,
  j.project_start_date,
  coalesce(j.project_end_date, j.project_start_date),
  case when j.status = 'completed' then 'done' else 'scheduled' end,
  'Scheduled before visits were tracked separately'
from jobs j
join properties p on p.id = j.property_id
join customers c on c.id = p.customer_id
where j.project_start_date is not null
  and not exists (select 1 from job_work_sessions s where s.job_id = j.id);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table job_work_sessions enable row level security;
alter table job_tickets enable row level security;

-- Same audience as the job itself: the crew doing the work are exactly who
-- needs to pause a visit or raise a snag, and they are not admins.
drop policy if exists "org_scoped_job_work_sessions" on job_work_sessions;
create policy "org_scoped_job_work_sessions" on job_work_sessions for all to authenticated
  using (
    organization_id = current_org_id()
    and exists (
      select 1 from jobs j
      join properties p on p.id = j.property_id
      join customers c on c.id = p.customer_id
      where j.id = job_work_sessions.job_id and c.organization_id = current_org_id()
    )
  )
  with check (
    organization_id = current_org_id()
    and exists (
      select 1 from jobs j
      join properties p on p.id = j.property_id
      join customers c on c.id = p.customer_id
      where j.id = job_work_sessions.job_id and c.organization_id = current_org_id()
    )
  );

drop policy if exists "org_scoped_job_tickets" on job_tickets;
create policy "org_scoped_job_tickets" on job_tickets for all to authenticated
  using (
    organization_id = current_org_id()
    and exists (
      select 1 from jobs j
      join properties p on p.id = j.property_id
      join customers c on c.id = p.customer_id
      where j.id = job_tickets.job_id and c.organization_id = current_org_id()
    )
  )
  with check (
    organization_id = current_org_id()
    and exists (
      select 1 from jobs j
      join properties p on p.id = j.property_id
      join customers c on c.id = p.customer_id
      where j.id = job_tickets.job_id and c.organization_id = current_org_id()
    )
  );

notify pgrst, 'reload schema';

-- =============================================================================
-- CATCH-UP: migrations 0078 through 0083, in order, in one file.
--
-- Every statement is idempotent, so running this when some of it has already
-- been applied is safe and does nothing twice. Paste the whole thing into
-- Supabase's SQL Editor and run it once.
--
-- What it adds, in order:
--   0078  Job sign-off with photos, and the private job-photos bucket
--   0079  Per-zone before/during/after
--   0080  Evaluation end times, work visits, tickets
--   0081  The account manager's walkthrough before the crew packs up
--   0082  The crew's Today screen
--   0083  Crew rosters on jobs
-- =============================================================================


-- ============================ 0078_job_completion_photos.sql ============================

-- Signing a job off with proof.
--
-- Marking work complete was a status change and nothing else: no record of who
-- said so, when, or what the site actually looked like when they left. That is
-- the one moment worth photographing — it is what settles a callback three
-- weeks later, and what a client sees when they ask what they paid for.

-- ---------------------------------------------------------------------------
-- Who signed it off
-- ---------------------------------------------------------------------------

-- Mirrors the cancellation columns from 0077 rather than inventing a second
-- pattern: the ending is on the job row either way.
alter table jobs add column if not exists completed_at timestamptz;
alter table jobs add column if not exists completed_by uuid references profiles(id);
alter table jobs add column if not exists completion_notes text;

-- ---------------------------------------------------------------------------
-- The photos
-- ---------------------------------------------------------------------------

create table if not exists job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  organization_id uuid not null references organizations(id),

  -- Path inside the job-photos bucket. First segment is the job id, which is
  -- what the storage policies below check, so the path is the access rule.
  path text not null unique,

  -- Before/after is the pair that actually answers a dispute; 'issue' is for
  -- the thing found on site that nobody wants to argue about later.
  kind text not null default 'after' check (kind in ('before', 'after', 'issue')),
  caption text,

  uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists job_photos_job_idx on job_photos(job_id, created_at);
create index if not exists job_photos_org_idx on job_photos(organization_id);

alter table job_photos enable row level security;

-- Same audience as the job itself. Anyone who can open the job can see and add
-- its photos — the crew who did the work are exactly who needs to upload them,
-- and they are not admins.
drop policy if exists "org_scoped_job_photos" on job_photos;
create policy "org_scoped_job_photos" on job_photos for all to authenticated
  using (
    organization_id = current_org_id()
    and exists (
      select 1 from jobs j
      join properties p on p.id = j.property_id
      join customers c on c.id = p.customer_id
      where j.id = job_photos.job_id and c.organization_id = current_org_id()
    )
  )
  with check (
    organization_id = current_org_id()
    and exists (
      select 1 from jobs j
      join properties p on p.id = j.property_id
      join customers c on c.id = p.customer_id
      where j.id = job_photos.job_id and c.organization_id = current_org_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

-- Private. These are photographs of customers' homes; a public bucket would
-- make every one of them readable by anyone holding the URL.
insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false)
on conflict (id) do nothing;

-- Access is decided by the first path segment being a job in the caller's
-- organization, the same shape message-attachments uses.
drop policy if exists "job_photos_read" on storage.objects;
create policy "job_photos_read" on storage.objects for select to authenticated
using (
  bucket_id = 'job-photos'
  and exists (
    select 1 from jobs j
    join properties p on p.id = j.property_id
    join customers c on c.id = p.customer_id
    where j.id::text = (storage.foldername(name))[1]
      and c.organization_id = current_org_id()
  )
);

drop policy if exists "job_photos_write" on storage.objects;
create policy "job_photos_write" on storage.objects for insert to authenticated
with check (
  bucket_id = 'job-photos'
  and exists (
    select 1 from jobs j
    join properties p on p.id = j.property_id
    join customers c on c.id = p.customer_id
    where j.id::text = (storage.foldername(name))[1]
      and c.organization_id = current_org_id()
  )
);

drop policy if exists "job_photos_delete" on storage.objects;
create policy "job_photos_delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'job-photos'
  and exists (
    select 1 from jobs j
    join properties p on p.id = j.property_id
    join customers c on c.id = p.customer_id
    where j.id::text = (storage.foldername(name))[1]
      and c.organization_id = current_org_id()
  )
);

notify pgrst, 'reload schema';


-- ============================ 0079_zone_photo_stages.sql ============================

-- Photos per zone, at three stages.
--
-- 0078 gave a job one pile of photos. That is enough to prove somebody stood
-- on the finished site, and not enough to prove anything about a particular
-- piece of work: a patio, a bed rebuild and a drainage run all end up in the
-- same pile, and the one zone nobody photographed is invisible.
--
-- 'during' joins before/after because it is the stage that actually settles
-- arguments — what the ground looked like once it was open, what was under the
-- old bed, how deep the base went. Nobody can go back for it later.

-- The stage a photo shows. 'issue' stays: a problem found on site is worth
-- recording and is not a stage of the work.
alter table job_photos drop constraint if exists job_photos_kind_check;
alter table job_photos add constraint job_photos_kind_check
  check (kind in ('before', 'during', 'after', 'issue'));

-- Which zone it belongs to. Text, not a foreign key: zones live inside the
-- canvas design's jsonb and have no table of their own. Null means the photo
-- is about the job as a whole rather than one zone, which is what every photo
-- taken before this migration was.
alter table job_photos add column if not exists zone_id text;
-- The zone's name as it was when the photo was taken. Denormalised on purpose:
-- zones get renamed and deleted, and a photo whose zone is gone should still
-- say what it was of rather than becoming an orphan nobody can place.
alter table job_photos add column if not exists zone_name text;

create index if not exists job_photos_zone_idx on job_photos(job_id, zone_id);

notify pgrst, 'reload schema';


-- ============================ 0080_sessions_and_tickets.sql ============================

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


-- ============================ 0081_final_walkthrough.sql ============================

-- The account manager walks the job before the crew packs up.
--
-- Sign-off was the crew's own call, which means the first person to find a
-- problem was the client. Going back for a snag costs a trip; catching it
-- while the tools are still out costs ten minutes. So there is now a step
-- between "we think we're done" and "we're done": somebody who did not do the
-- work has to stand on the site and say so.
--
-- Deliberately a table rather than a column pair. A walkthrough that fails
-- happens again after the fix, and the interesting record is the sequence —
-- what was wrong the first time, and whether it was right the second.

create table if not exists job_walkthroughs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  organization_id uuid not null references organizations(id),

  -- Raised by the crew from site. The whole point is that this happens while
  -- they are still standing there.
  requested_by uuid references profiles(id),
  requested_at timestamptz not null default now(),
  -- Where the crew was when they asked, so "he never came out" and "they'd
  -- already left" stop being the same conversation.
  requested_note text,

  status text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected', 'cancelled')),

  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  -- What the manager saw. On a rejection this is the punch list.
  review_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A decision without a decider is not a decision.
  constraint job_walkthroughs_decided check (
    status in ('requested', 'cancelled')
    or (reviewed_by is not null and reviewed_at is not null)
  )
);

create index if not exists job_walkthroughs_job_idx
  on job_walkthroughs(job_id, requested_at desc);
-- Drives the "waiting on you" queue, so it stays cheap as history builds up.
create index if not exists job_walkthroughs_pending_idx
  on job_walkthroughs(organization_id, status) where status = 'requested';

drop trigger if exists set_updated_at on job_walkthroughs;
create trigger set_updated_at before update on job_walkthroughs
  for each row execute function set_updated_at();

alter table job_walkthroughs enable row level security;

-- Same audience as the job. The crew raise it, the manager decides it, and
-- both need to see it; narrowing writes to managers would stop the crew
-- asking, which is the half that matters most.
drop policy if exists "org_scoped_job_walkthroughs" on job_walkthroughs;
create policy "org_scoped_job_walkthroughs" on job_walkthroughs for all to authenticated
  using (
    organization_id = current_org_id()
    and exists (
      select 1 from jobs j
      join properties p on p.id = j.property_id
      join customers c on c.id = p.customer_id
      where j.id = job_walkthroughs.job_id and c.organization_id = current_org_id()
    )
  )
  with check (
    organization_id = current_org_id()
    and exists (
      select 1 from jobs j
      join properties p on p.id = j.property_id
      join customers c on c.id = p.customer_id
      where j.id = job_walkthroughs.job_id and c.organization_id = current_org_id()
    )
  );

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Being told about it
-- ---------------------------------------------------------------------------

-- Defaults on, unlike most notification kinds. A walkthrough request is
-- somebody standing on a site waiting for you; a manager who silently never
-- opted in is the failure mode this whole feature exists to prevent.
alter table notification_preferences
  add column if not exists walkthrough_requests boolean not null default true;

notify pgrst, 'reload schema';


-- ============================ 0082_crew_day.sql ============================

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


-- ============================ 0083_job_crew.sql ============================

-- Who is working this job.
--
-- jobs.assigned_to held exactly one person, which is not what a crew is. Three
-- people on a patio meant picking one to be "assigned" and leaving the other
-- two with no record and — since the Today screen keys off assignment — no
-- stops on their own phones.
--
-- So the roster becomes its own table and jobs.assigned_to becomes a
-- projection of it: the lead, maintained by trigger. Every existing query,
-- filter and notification that reads assigned_to keeps working untouched,
-- against one source of truth rather than two that can drift.

create table if not exists job_crew (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  profile_id uuid not null references profiles(id) on delete cascade,

  -- The one who answers for the job. At most one per job, enforced below.
  is_lead boolean not null default false,

  added_by uuid references profiles(id),
  created_at timestamptz not null default now(),

  -- Somebody is on a job once, not twice.
  unique (job_id, profile_id)
);

-- One lead per job. A partial unique index rather than a check, because the
-- rule is about the set and not about any single row.
create unique index if not exists job_crew_one_lead_idx
  on job_crew(job_id) where is_lead;

create index if not exists job_crew_job_idx on job_crew(job_id);
-- Drives "my jobs" on the Today screen, so it stays cheap as history builds.
create index if not exists job_crew_profile_idx on job_crew(profile_id);

alter table job_crew enable row level security;

-- Same audience as the job itself: anyone who can open a job can see who is on
-- it. Being able to see your own crew is not a privilege worth withholding.
drop policy if exists "org_scoped_job_crew" on job_crew;
create policy "org_scoped_job_crew" on job_crew for all to authenticated
  using (
    organization_id = current_org_id()
    and exists (
      select 1 from jobs j
      join properties p on p.id = j.property_id
      join customers c on c.id = p.customer_id
      where j.id = job_crew.job_id and c.organization_id = current_org_id()
    )
  )
  with check (
    organization_id = current_org_id()
    and exists (
      select 1 from jobs j
      join properties p on p.id = j.property_id
      join customers c on c.id = p.customer_id
      where j.id = job_crew.job_id and c.organization_id = current_org_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Backfill, before the trigger exists
-- ---------------------------------------------------------------------------

-- Everybody currently assigned becomes that job's lead, so nothing changes
-- hands the moment the roster takes over.
insert into job_crew (job_id, organization_id, profile_id, is_lead)
select j.id, c.organization_id, j.assigned_to, true
from jobs j
join properties p on p.id = j.property_id
join customers c on c.id = p.customer_id
where j.assigned_to is not null
on conflict (job_id, profile_id) do nothing;

-- ---------------------------------------------------------------------------
-- Keeping jobs.assigned_to in step
-- ---------------------------------------------------------------------------

-- The column becomes "who leads this job", derived. When the lead is removed
-- it falls to whoever else is on the crew rather than dropping to null: a job
-- with people on it is not unassigned, and blanking it would hide the job from
-- every list that filters on assignment.
create or replace function sync_job_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.job_id, old.job_id);
  lead uuid;
begin
  select profile_id into lead
  from job_crew
  where job_id = target
  order by is_lead desc, created_at asc
  limit 1;

  update jobs set assigned_to = lead where id = target;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_job_lead_change on job_crew;
create trigger sync_job_lead_change after insert or update or delete on job_crew
  for each row execute function sync_job_lead();

notify pgrst, 'reload schema';


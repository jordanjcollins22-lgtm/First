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

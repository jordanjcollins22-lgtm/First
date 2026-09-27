-- Who is working in which area of a job, which kit is there, and which steps
-- are done.
--
-- On site the crew pick an area to start on. Two people can work the same
-- area or split up. An area takes the kits its service needs, and a kit in
-- one area cannot be in another: so an area whose kit is somewhere else
-- waits, and says where the kit is. When the area's after photo is in, the
-- people in it are freed and so are its kits.
--
-- The steps are the area's checklist: prep, then the work, then the clean
-- up. What the steps are comes from the service, in code; this records only
-- which were ticked, by whom and when, so the office can see what stage
-- every area is at.

create table if not exists job_area_work (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  -- The zone's id from the site map.
  zone_id text not null check (length(btrim(zone_id)) > 0),
  profile_id uuid not null references profiles(id) on delete cascade,
  -- The kit numbers this area is holding while anybody is in it.
  kits integer[] not null default '{}',
  started_at timestamptz not null default now(),
  left_at timestamptz
);

-- One area at a time per person per job.
create unique index if not exists job_area_work_one_open
  on job_area_work (job_id, profile_id) where left_at is null;
create index if not exists job_area_work_job_idx on job_area_work (job_id, zone_id);

alter table job_area_work enable row level security;
drop policy if exists job_area_work_own_org on job_area_work;
create policy job_area_work_own_org on job_area_work
  for all using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

create table if not exists job_area_steps (
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  zone_id text not null,
  step_key text not null,
  done_by uuid references profiles(id) on delete set null,
  done_at timestamptz not null default now(),
  primary key (job_id, zone_id, step_key)
);

alter table job_area_steps enable row level security;
drop policy if exists job_area_steps_own_org on job_area_steps;
create policy job_area_steps_own_org on job_area_steps
  for all using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

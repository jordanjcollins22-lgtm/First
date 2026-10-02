-- Every time the crew does a service, how long it took, so production rates
-- come from real jobs instead of guesses.
--
-- On site, a timer is started on a service in an area (hand weed pulling in
-- Zone 1) and stopped when it is done, with how much got done and how many
-- people were on it. Across all jobs a service's rate is the work done over
-- the labour-hours it took: ΣQ ÷ Σ(clock hours × people).
create table if not exists service_time_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  -- The area on the site map, by its id and by the name it had.
  zone_id text not null,
  zone_name text not null,
  -- The service, by its key on the production rates, with its unit as it was.
  service_key text not null,
  unit text not null,
  -- What it was priced at, and how much actually got done.
  planned_quantity numeric,
  quantity numeric check (quantity is null or quantity >= 0),
  people integer check (people is null or people between 1 and 20),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  started_by uuid references profiles(id) on delete set null,
  finished_by uuid references profiles(id) on delete set null,
  -- Left out of the average by an owner or admin: a timer left running, a mistake.
  excluded boolean not null default false,
  created_at timestamptz not null default now(),
  constraint service_time_logs_finished check (finished_at is null or (finished_at > started_at and quantity is not null and people is not null))
);

comment on table service_time_logs is
  'Each service timed on site: job, area, how much got done, how long, how many people. Production rates are averaged from these.';

create index if not exists service_time_logs_service_idx on service_time_logs (organization_id, service_key, finished_at desc);
create index if not exists service_time_logs_job_idx on service_time_logs (job_id);

alter table service_time_logs enable row level security;

-- The team reads and writes its own business's timers. Leaving one out of
-- the average is checked for an owner or admin by the server.
drop policy if exists service_time_logs_own_org on service_time_logs;
create policy service_time_logs_own_org on service_time_logs
  for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';

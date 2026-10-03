-- Replaces the plain weekly-off toggle with a real weekly availability
-- setup: which days you work AND what hours each day, set once and edited
-- deliberately (not a live per-click toggle). A row = "I work this day,
-- these hours"; no row for a day of week = not available that day.

drop table if exists availability_weekly_off;

create table if not exists availability_weekly (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  profile_id uuid not null references profiles(id) on delete cascade,
  -- 0 = Sunday .. 6 = Saturday.
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, day_of_week),
  check (start_time < end_time)
);

drop trigger if exists set_updated_at on availability_weekly;
create trigger set_updated_at before update on availability_weekly for each row execute function set_updated_at();

alter table availability_weekly enable row level security;
drop policy if exists "view_org_weekly_availability" on availability_weekly;
create policy "view_org_weekly_availability" on availability_weekly for select to authenticated
  using (organization_id = current_org_id());
drop policy if exists "manage_own_weekly_availability" on availability_weekly;
create policy "manage_own_weekly_availability" on availability_weekly for all to authenticated
  using (organization_id = current_org_id() and (profile_id = auth.uid() or is_admin()))
  with check (organization_id = current_org_id() and (profile_id = auth.uid() or is_admin()));

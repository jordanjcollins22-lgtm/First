-- Calendar view on Evaluations: lets each person set which days of the
-- week they normally work (weekly_off) and mark specific dates off
-- (days_off, vacation/sick/etc). Everyone in the org can see who's off so
-- scheduling doesn't collide; only the owner (or an admin) can change it.

create table if not exists availability_weekly_off (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  profile_id uuid not null references profiles(id) on delete cascade,
  -- 0 = Sunday .. 6 = Saturday. Presence of a row = doesn't normally work that day.
  day_of_week smallint not null check (day_of_week between 0 and 6),
  created_at timestamptz not null default now(),
  unique (profile_id, day_of_week)
);

create table if not exists availability_days_off (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  profile_id uuid not null references profiles(id) on delete cascade,
  date date not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (profile_id, date)
);

alter table availability_weekly_off enable row level security;
drop policy if exists "view_org_weekly_off" on availability_weekly_off;
create policy "view_org_weekly_off" on availability_weekly_off for select to authenticated
  using (organization_id = current_org_id());
drop policy if exists "manage_own_weekly_off" on availability_weekly_off;
create policy "manage_own_weekly_off" on availability_weekly_off for all to authenticated
  using (organization_id = current_org_id() and (profile_id = auth.uid() or is_admin()))
  with check (organization_id = current_org_id() and (profile_id = auth.uid() or is_admin()));

alter table availability_days_off enable row level security;
drop policy if exists "view_org_days_off" on availability_days_off;
create policy "view_org_days_off" on availability_days_off for select to authenticated
  using (organization_id = current_org_id());
drop policy if exists "manage_own_days_off" on availability_days_off;
create policy "manage_own_days_off" on availability_days_off for all to authenticated
  using (organization_id = current_org_id() and (profile_id = auth.uid() or is_admin()))
  with check (organization_id = current_org_id() and (profile_id = auth.uid() or is_admin()));

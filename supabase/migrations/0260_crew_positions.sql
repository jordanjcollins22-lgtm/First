-- Where the crew are.
--
-- One row per person, overwritten as the phone reports in: the office
-- wants to know where somebody is now and which house they are heading
-- to, not to replay their morning. The day's story is in crew_day_events.

create table if not exists crew_positions (
  profile_id uuid primary key references profiles(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  at timestamptz not null default now(),
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  heading double precision
);

create index if not exists crew_positions_org_idx on crew_positions(organization_id);

alter table crew_positions enable row level security;

drop policy if exists "crew_positions_own_write" on crew_positions;
create policy "crew_positions_own_write" on crew_positions for all to authenticated
  using (organization_id = current_org_id() and profile_id = auth.uid())
  with check (organization_id = current_org_id() and profile_id = auth.uid());

drop policy if exists "crew_positions_office_read" on crew_positions;
create policy "crew_positions_office_read" on crew_positions for select to authenticated
  using (
    organization_id = current_org_id()
    and exists (
      select 1 from profile_roles pr
      where pr.profile_id = auth.uid() and pr.role_name in ('admin', 'owner', 'overhead', 'account manager')
    )
  );

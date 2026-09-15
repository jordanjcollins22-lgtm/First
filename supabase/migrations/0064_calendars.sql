-- Named calendars an admin manages, with people assigned to each — e.g. an
-- "Evaluations" calendar for the evaluator team and an "Installs" calendar
-- for the crews. Scheduling still happens on the jobs themselves; this is
-- the roster of calendars and who belongs to them.

create table if not exists calendars (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  color text not null default '#2f6d3c',
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calendars_organization_id_idx on calendars(organization_id);

drop trigger if exists set_updated_at on calendars;
create trigger set_updated_at before update on calendars for each row execute function set_updated_at();

alter table calendars enable row level security;
drop policy if exists "org_scoped_calendars" on calendars;
create policy "org_scoped_calendars" on calendars for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- Who's on each calendar. Deleting a calendar or a profile clears the
-- membership rather than leaving an orphan row.
create table if not exists calendar_members (
  calendar_id uuid not null references calendars(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (calendar_id, profile_id)
);

alter table calendar_members enable row level security;
drop policy if exists "org_scoped_calendar_members" on calendar_members;
create policy "org_scoped_calendar_members" on calendar_members for all to authenticated
  using (
    exists (
      select 1 from calendars c
      where c.id = calendar_members.calendar_id and c.organization_id = current_org_id()
    )
  )
  with check (
    exists (
      select 1 from calendars c
      where c.id = calendar_members.calendar_id and c.organization_id = current_org_id()
    )
  );

notify pgrst, 'reload schema';

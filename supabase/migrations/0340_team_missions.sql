-- Missions: a team member picks a category of bringing work in (people they
-- know, local businesses, door hangers...), the app hands them one mission
-- from it with a goal, and they count their way to the goal against the
-- clock. Kept so they see their best times and the office sees who is out
-- there doing the human part of the marketing.
create table if not exists team_missions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  -- Which board square and which mission in it, as the app's catalog names them.
  category text not null,
  mission_key text not null,
  title text not null,
  goal integer not null check (goal > 0),
  progress integer not null default 0 check (progress >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  abandoned_at timestamptz
);

comment on table team_missions is
  'A team member''s marketing missions: the category picked, the mission handed out, its goal, how far they got, and when they started and finished.';

create index if not exists team_missions_profile_idx on team_missions (profile_id, started_at desc);
create index if not exists team_missions_org_idx on team_missions (organization_id, started_at desc);

alter table team_missions enable row level security;

drop policy if exists team_missions_own_org on team_missions;
create policy team_missions_own_org on team_missions
  for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';

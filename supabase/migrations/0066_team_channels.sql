-- Internal team communication that isn't attached to a job — a group the
-- team messages in directly ("Crew 1", "Office", "Safety"). Client-facing
-- conversation stays in job_messages, where it's tied to the job it's about
-- and goes out over SMS.

create table if not exists team_channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  description text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists team_channels_organization_id_idx on team_channels(organization_id);

drop trigger if exists set_updated_at on team_channels;
create trigger set_updated_at before update on team_channels for each row execute function set_updated_at();

alter table team_channels enable row level security;
drop policy if exists "org_scoped_team_channels" on team_channels;
create policy "org_scoped_team_channels" on team_channels for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

create table if not exists team_channel_members (
  channel_id uuid not null references team_channels(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (channel_id, profile_id)
);

alter table team_channel_members enable row level security;
drop policy if exists "org_scoped_team_channel_members" on team_channel_members;
create policy "org_scoped_team_channel_members" on team_channel_members for all to authenticated
  using (
    exists (
      select 1 from team_channels c
      where c.id = team_channel_members.channel_id and c.organization_id = current_org_id()
    )
  )
  with check (
    exists (
      select 1 from team_channels c
      where c.id = team_channel_members.channel_id and c.organization_id = current_org_id()
    )
  );

create table if not exists team_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references team_channels(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  author_profile_id uuid references profiles(id),
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists team_messages_channel_id_idx on team_messages(channel_id, created_at);

-- Unlike the org-wide tables above, a group's messages are readable only by
-- the people in that group — a group nobody added you to isn't yours to read.
alter table team_messages enable row level security;
drop policy if exists "member_scoped_team_messages" on team_messages;
create policy "member_scoped_team_messages" on team_messages for all to authenticated
  using (
    exists (
      select 1 from team_channel_members m
      where m.channel_id = team_messages.channel_id and m.profile_id = auth.uid()
    )
  )
  with check (
    organization_id = current_org_id()
    and exists (
      select 1 from team_channel_members m
      where m.channel_id = team_messages.channel_id and m.profile_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';

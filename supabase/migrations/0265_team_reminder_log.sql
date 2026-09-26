-- Which team reminders went out, so a rerun never sends one twice.

create table if not exists team_reminder_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  day date not null,
  kind text not null,
  sent_at timestamptz not null default now(),
  detail text,
  unique (profile_id, day, kind)
);

alter table team_reminder_log enable row level security;

drop policy if exists "team_reminder_log_org_read" on team_reminder_log;
create policy "team_reminder_log_org_read" on team_reminder_log for select to authenticated
  using (organization_id = current_org_id());

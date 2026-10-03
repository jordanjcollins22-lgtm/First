-- Per-person notification settings. Anyone in the app can turn these on for
-- themselves — it's their own phone, not something an admin configures for
-- them — so the policy is scoped to the signed-in user's own row rather than
-- the whole org.
--
-- Texts go to profiles.phone, which the Team page already collects.

create table if not exists notification_preferences (
  profile_id uuid primary key references profiles(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  sms_enabled boolean not null default false,
  appointment_reminders boolean not null default true,
  client_messages boolean not null default true,
  proposal_responses boolean not null default true,
  team_messages boolean not null default false,
  /** How far ahead of an appointment the reminder goes out. */
  reminder_hours_before integer not null default 24,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on notification_preferences;
create trigger set_updated_at before update on notification_preferences
  for each row execute function set_updated_at();

alter table notification_preferences enable row level security;
drop policy if exists "own_notification_preferences" on notification_preferences;
create policy "own_notification_preferences" on notification_preferences for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and organization_id = current_org_id());

-- Which appointment reminders have already gone out, so a re-run of the
-- reminder job doesn't text somebody the same appointment twice.
create table if not exists notification_log (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  kind text not null,
  reference_id text not null,
  sent_at timestamptz not null default now(),
  unique (profile_id, kind, reference_id)
);

alter table notification_log enable row level security;
drop policy if exists "own_notification_log" on notification_log;
create policy "own_notification_log" on notification_log for select to authenticated
  using (profile_id = auth.uid());

notify pgrst, 'reload schema';

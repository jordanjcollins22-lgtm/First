-- ============================================================
-- Team check-ins over SMS (GoHighLevel).
--
-- team_members      : who's on the crew + their phone (the identity key for
--                     inbound texts) and their cached GHL contact id.
-- check_in_schedules: recurring "text this person at HH:MM on these days".
-- check_ins         : one row per scheduled send; tracks reply / late / missed.
-- sms_messages      : log of every outbound + inbound text.
-- ============================================================

create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- E.164 (e.g. +15551234567). Normalized in app code before insert.
  phone text not null unique,
  role text,
  timezone text not null default 'America/New_York',
  -- Managers get texted when someone misses a check-in or reports a delay.
  is_manager boolean not null default false,
  active boolean not null default true,
  ghl_contact_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists check_in_schedules (
  id uuid primary key default gen_random_uuid(),
  team_member_id uuid not null references team_members(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  label text not null default 'Check-in',
  -- 0 = Sunday ... 6 = Saturday, in the team member's timezone.
  days_of_week smallint[] not null default '{1,2,3,4,5}',
  -- Local wall-clock time, "HH:MM" (24h).
  time_of_day text not null check (time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- Supports {name} and {job} placeholders.
  message text not null,
  -- How long they have to reply before it counts as missed.
  response_window_minutes integer not null default 30 check (response_window_minutes > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists check_in_schedules_member_idx on check_in_schedules (team_member_id);

create table if not exists check_ins (
  id uuid primary key default gen_random_uuid(),
  team_member_id uuid not null references team_members(id) on delete cascade,
  schedule_id uuid references check_in_schedules(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  -- The occurrence this row represents; (schedule_id, scheduled_for) is the
  -- idempotency key so overlapping cron runs never double-text someone.
  scheduled_for timestamptz not null,
  due_by timestamptz not null,
  message text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'responded', 'late', 'missed', 'failed')),
  sent_at timestamptz,
  responded_at timestamptz,
  response_text text,
  -- Claude's read of the reply.
  reply_assessment text check (reply_assessment in ('on_track', 'delayed', 'blocked', 'unclear')),
  reply_summary text,
  escalated_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_id, scheduled_for)
);

create index if not exists check_ins_member_status_idx on check_ins (team_member_id, status, scheduled_for desc);
create index if not exists check_ins_status_due_idx on check_ins (status, due_by);

create table if not exists sms_messages (
  id uuid primary key default gen_random_uuid(),
  team_member_id uuid references team_members(id) on delete set null,
  check_in_id uuid references check_ins(id) on delete set null,
  direction text not null check (direction in ('outbound', 'inbound')),
  phone text,
  body text not null,
  ghl_contact_id text,
  ghl_message_id text,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sms_messages_member_idx on sms_messages (team_member_id, created_at desc);

do $$
declare
  t text;
begin
  foreach t in array array['team_members', 'check_in_schedules', 'check_ins']
  loop
    execute format(
      'drop trigger if exists set_updated_at on %I; create trigger set_updated_at before update on %I for each row execute function set_updated_at();',
      t, t
    );
  end loop;
end $$;

alter table team_members enable row level security;
alter table check_in_schedules enable row level security;
alter table check_ins enable row level security;
alter table sms_messages enable row level security;

-- Same MVP policy as the rest of the schema. The cron + webhook routes use the
-- service-role key (no user session) and bypass RLS.
do $$
declare
  t text;
begin
  foreach t in array array['team_members', 'check_in_schedules', 'check_ins', 'sms_messages']
  loop
    execute format(
      'drop policy if exists "authenticated_full_access" on %I; create policy "authenticated_full_access" on %I for all to authenticated using (true) with check (true);',
      t, t
    );
  end loop;
end $$;

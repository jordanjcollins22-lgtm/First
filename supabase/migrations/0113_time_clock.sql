-- What people actually worked.
--
-- A scheduled visit says what somebody was meant to do. This says what they
-- did — which is the number payroll runs on and the only honest input to what
-- a job really cost.
--
-- Two timestamps and nothing derived. No stored duration and no stored pay: a
-- stored total goes on being right long after the times it came from have
-- been corrected, which is exactly the situation this table exists to allow.

create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,

  -- Null for work that is not against a job — the yard, the shop, loading up.
  job_id uuid references jobs(id) on delete set null,

  clocked_in_at timestamptz not null default now(),
  -- Null while somebody is still on it.
  clocked_out_at timestamptz,

  note text,

  -- Who corrected it, if anybody did. A time somebody changed by hand and a
  -- time the clock recorded are different kinds of fact, and a sheet that
  -- cannot tell them apart cannot be argued from.
  edited_by uuid references profiles(id),
  edited_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists time_entries_org_day_idx
  on time_entries(organization_id, clocked_in_at desc);
create index if not exists time_entries_person_idx
  on time_entries(profile_id, clocked_in_at desc);
-- The "who is on right now" question, which the admin screen asks on every load.
create index if not exists time_entries_open_idx
  on time_entries(organization_id) where clocked_out_at is null;

alter table time_entries enable row level security;
drop policy if exists "org_scoped_time_entries" on time_entries;
create policy "org_scoped_time_entries" on time_entries for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';

-- Career tracker: each team member's progress up the 21-stage ladder
-- (Technician 1-7, General Manager 8-14, Owner 15-21).
--
-- The stages themselves live in the app (src/lib/career/stages.ts). This
-- table holds one row per person per stage they have started:
--
--   count         progress toward the stage's number, where it has one
--                 (5 reviews, 2 morning meetings, 3 new hires mentored).
--   completed_at  set when somebody signs the stage off.
--   completed_by  who signed it off.
--
-- Promotions are earned, so nobody but an admin can sign off or change their
-- own stages.

create table if not exists career_progress (
  organization_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  stage smallint not null check (stage between 1 and 21),
  count integer not null default 0 check (count between 0 and 999),
  note text,
  completed_at timestamptz,
  completed_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, stage)
);

create index if not exists career_progress_org_idx on career_progress (organization_id);

drop trigger if exists set_updated_at on career_progress;
create trigger set_updated_at before update on career_progress
  for each row execute function set_updated_at();

alter table career_progress enable row level security;

-- Anyone in the organization can read it: a team member sees their own path,
-- and the page that lists everybody is gated in the app.
drop policy if exists career_progress_read on career_progress;
create policy career_progress_read on career_progress
  for select using (organization_id = current_org_id());

-- Writes stay in the organization, and never on your own row unless you are
-- an admin.
drop policy if exists career_progress_insert on career_progress;
create policy career_progress_insert on career_progress
  for insert with check (
    organization_id = current_org_id() and (profile_id <> auth.uid() or is_admin())
  );

drop policy if exists career_progress_update on career_progress;
create policy career_progress_update on career_progress
  for update using (
    organization_id = current_org_id() and (profile_id <> auth.uid() or is_admin())
  ) with check (
    organization_id = current_org_id() and (profile_id <> auth.uid() or is_admin())
  );

drop policy if exists career_progress_delete on career_progress;
create policy career_progress_delete on career_progress
  for delete using (
    organization_id = current_org_id() and (profile_id <> auth.uid() or is_admin())
  );

comment on table career_progress is
  'Each team member''s progress on the 21-stage career ladder: a count toward each stage''s target and when it was signed off.';

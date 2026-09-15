-- Changes made to an evaluation after the walk.
--
-- The evaluation is captured on the site map, which is right for the walk
-- and wrong for everything afterwards. A client texts "the back bed is more
-- like thirty foot" and somebody in the office changes the number. Without a
-- record, the measurement simply differs from what was measured on the day,
-- with nothing saying who changed it or why — and the price follows the
-- measurement.
--
-- One row per save, holding the list of changes in the words somebody would
-- use out loud, so it reads as a record rather than two snapshots to diff.

create table if not exists evaluation_edits (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  edited_by uuid references profiles(id) on delete set null,
  edited_by_name text,
  -- ["Back bed measurement 20 × 10 ft → 30 × 10 ft", "Removed Front bed"]
  changes jsonb not null default '[]',
  -- How the client asked: text, call, in_person, or office for our own call.
  requested_via text,
  -- What they actually said, in their words.
  note text,
  created_at timestamptz not null default now()
);

create index if not exists evaluation_edits_job_idx on evaluation_edits (job_id, created_at desc);

alter table evaluation_edits enable row level security;
drop policy if exists "org_scoped_evaluation_edits" on evaluation_edits;
create policy "org_scoped_evaluation_edits" on evaluation_edits for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';

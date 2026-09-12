-- The manager's look at the finished work, before the client sees it.
--
-- The crew sign off from site. Nobody senior has been back, and the first
-- person to notice the bed that was never re-edged is the customer standing
-- next to the account manager on a walkthrough. This is the step in between.
--
-- A mark is a pin plus an instruction. The note is not optional and the check
-- constraint says so: a pin on its own sends somebody back to a garden to
-- look at a photograph and guess.

create table if not exists job_photo_marks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  photo_id uuid not null references job_photos(id) on delete cascade,

  -- Fractions of the image, 0-1, so a pin lands in the same place on the
  -- manager's phone and the crew's without anybody recomputing it.
  x double precision not null check (x >= 0 and x <= 1),
  y double precision not null check (y >= 0 and y <= 1),

  note text not null check (length(btrim(note)) > 0),

  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),

  -- Cleared by the crew once they have been back and done it.
  resolved_at timestamptz,
  resolved_by uuid references profiles(id)
);

create index if not exists job_photo_marks_job_idx on job_photo_marks(job_id, created_at);
create index if not exists job_photo_marks_open_idx
  on job_photo_marks(job_id) where resolved_at is null;

alter table job_photo_marks enable row level security;
drop policy if exists "org_scoped_job_photo_marks" on job_photo_marks;
create policy "org_scoped_job_photo_marks" on job_photo_marks for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- When the photos were signed off, and by whom.
--
-- Stored rather than derived because it is a decision somebody made at a
-- moment, not a fact about the data. Everything else about the review — the
-- punch list, whether it is clear, whether the approval still covers what is
-- there — is worked out from the marks against this timestamp.
alter table jobs add column if not exists photos_approved_at timestamptz;
alter table jobs add column if not exists photos_approved_by uuid references profiles(id);

notify pgrst, 'reload schema';

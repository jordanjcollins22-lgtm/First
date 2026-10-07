-- Declining a job is a fact about it, not a note about a moment.
--
-- The pipeline derives where a job sits from what is already true, which is
-- right, and lets somebody move a card by hand when the paperwork has not
-- caught up. A hand placement is stored against the answer it was overriding
-- so that it expires once the facts move -- also right, for the cases it was
-- built for: "they said yes on the phone while the proposal still says sent".
--
-- Declining is not one of those cases. "They said no" does not stop being
-- true when somebody later reschedules the visit or regenerates the quote,
-- and storing it as a perishable override meant exactly that: the placement
-- went stale, the board quietly went back to reading the raw statuses, and
-- the job reappeared as a live quote to chase. Seven jobs were in that state
-- when this was written, one of them counted as won revenue.
--
-- So a decline is stored. It is the same kind of fact as cancelled_at, which
-- has always been a column, and for the same reason.
alter table jobs
  add column if not exists declined_at timestamptz,
  add column if not exists declined_by uuid references profiles(id) on delete set null,
  add column if not exists declined_reason text;

comment on column jobs.declined_at is
  'When somebody decided this job was not happening, whether the client clicked decline or said it on the phone. Survives later status changes, unlike a pipeline override.';
comment on column jobs.declined_reason is
  'Why, in their words. Worth more than the date for anybody reading the book back.';

create index if not exists jobs_declined_idx on jobs (declined_at) where declined_at is not null;

-- Everything already moved to Declined by hand, whether or not its placement
-- has since gone stale. These are the jobs the app has been chasing people
-- about, so they are the whole point of the column existing.
update jobs
set declined_at = coalesce(pipeline_override_at, now())
where pipeline_override_stage = 'sales'
  and pipeline_override_status = 'Declined'
  and declined_at is null;

-- And anything the client themselves declined on their proposal. The board
-- already read those correctly; the column just makes the two agree.
update jobs j
set declined_at = coalesce(p.responded_at, now())
from job_proposals p
where p.job_id = j.id
  and p.status = 'declined'
  and j.declined_at is null;

notify pgrst, 'reload schema';

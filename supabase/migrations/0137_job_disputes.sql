-- Jobs that have gone wrong.
--
-- The board reads a job's position off what is true about it: booked, quoted,
-- sold, being built. None of that has an answer for a client threatening to
-- sue, or refusing to pay. Those jobs sat in Operations looking like work to
-- get on with, which is exactly what nobody should do with them.
--
-- Deliberately not a job status. A dispute is something that happened to a
-- job which already had a position, and when it is resolved the job goes back
-- to being read normally rather than needing to be put back by hand.
--
-- Resolving records a date rather than clearing the row. The history is the
-- point: whoever quotes this client next should be able to find out that the
-- last job ended with a solicitor's letter.

alter table jobs add column if not exists dispute_opened_at timestamptz;
alter table jobs add column if not exists dispute_resolved_at timestamptz;
-- legal, payment, quality or other.
alter table jobs add column if not exists dispute_kind text;
alter table jobs add column if not exists dispute_reason text;
alter table jobs add column if not exists dispute_opened_by uuid references profiles(id) on delete set null;

comment on column jobs.dispute_opened_at is
  'When this job went into dispute. A job is in dispute while this is set and later than dispute_resolved_at, which is how a second dispute reopens one that was closed.';
comment on column jobs.dispute_reason is
  'What is wrong, in the office''s own words. Shown on the pipeline card so the board says it without anybody opening the job.';

-- The board reads this constantly; the column is null on nearly every row.
create index if not exists jobs_in_dispute_idx on jobs (dispute_opened_at)
  where dispute_opened_at is not null;

notify pgrst, 'reload schema';

-- Whether we drove out to it, or did it over a screen.
--
-- The business is in Harford County. Work further out is still worth having,
-- but sending somebody ninety minutes each way to quote a patio is how a free
-- evaluation stops being free — so the far ones happen on a video call, with
-- the client walking us round.
--
-- Recorded on the job because it changes what the day looks like. A video
-- walkthrough takes no drive time, so it should not be planned into a round
-- like a visit, and an evaluator opening their day needs to know which of the
-- two they are doing before they get in the van.
--
-- Defaults to on site: every job that existed before this column was a visit.
alter table jobs
  add column if not exists evaluation_mode text not null default 'in_person'
    check (evaluation_mode in ('in_person', 'digital'));

comment on column jobs.evaluation_mode is
  'Whether the evaluation is a visit or a video walkthrough. Decided from the property''s coordinates at booking: Harford County and roughly 25 miles beyond it get a visit, everywhere else gets a call.';

notify pgrst, 'reload schema';

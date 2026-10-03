-- The scheduling engine, off by default.
--
-- Two decisions are encoded here and both are deliberate.
--
-- **It is a flag, not a rollout.** An engine that starts recommending dates on
-- the morning it ships would be making its first suggestions against a
-- calendar nobody had checked it understood. The owner turns it on when they
-- have looked at what it says and agreed with it, and turns it off again if it
-- talks nonsense. Nothing about the flag is per-user: this is a decision about
-- the business, not a preference.
--
-- **It never writes a session.** There is no cron here, no trigger, nothing
-- that moves booked work. The engine produces suggestions; a person presses a
-- button; that button books the visit. Everything already on the calendar
-- stays exactly where somebody put it. An engine that quietly re-arranged a
-- week would be one nobody could trust with the next week either.
--
-- The audit trail gains a fourth subject so accepting a suggestion is
-- recorded the way every other decision on a job is -- who, when, and what the
-- engine had said.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS schedule_engine_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.job_audit_events
  DROP CONSTRAINT IF EXISTS job_audit_events_subject_kind_check;
ALTER TABLE public.job_audit_events
  ADD CONSTRAINT job_audit_events_subject_kind_check
  CHECK (subject_kind IN ('exception', 'scope_change', 'progress', 'assignment', 'schedule'));

NOTIFY pgrst, 'reload schema';

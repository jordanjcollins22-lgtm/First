-- An email the app writes to somebody on the team, held like the rest.
--
-- The first one: a request to the evaluator for the measurements of the
-- areas they drew but did not measure, because a proposal cannot be priced
-- without them. It waits for the owner's approval like every other
-- automatic email.
ALTER TABLE public.outbound_approvals DROP CONSTRAINT IF EXISTS outbound_approvals_source_check;
ALTER TABLE public.outbound_approvals
  ADD CONSTRAINT outbound_approvals_source_check
  CHECK (source IN ('evaluation_sequence', 'client_reminder', 'team_request'));

-- Approved and sent are two different facts.
--
-- A proposal's status went to "sent" the moment the office approved it,
-- because approving used to be the moment the link was handed over. Now
-- the client's email waits on My Day, so a proposal can be approved and
-- not yet sent. sent_at records the moment the email actually went, or
-- the moment somebody said they sent the link themselves. Proposals
-- approved before this change were handed over by hand and count as sent.
-- A row that would trip the visible-price check on any update (an old
-- accepted proposal at $0) is left alone; the app reads a missing sent_at
-- on such a row the old way.
ALTER TABLE public.job_proposals ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

UPDATE public.job_proposals
SET sent_at = approved_at
WHERE sent_at IS NULL
  AND approved_at IS NOT NULL
  AND status IN ('sent', 'accepted', 'declined')
  AND approved_at < '2026-09-21 15:00:00+00'
  AND (status NOT IN ('sent', 'accepted') OR coalesce(total_cost, 0) - coalesce(discount_amount, 0) > 0);

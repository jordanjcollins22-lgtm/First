-- Money that went back out, and what the work tells the marketing.
--
-- A receipt is not a permanent fact. Money comes in and then leaves again: a
-- refund, a chargeback the bank takes without asking, a reversal, a payment
-- voided before it settled. A deposit check reading receipts alone goes on
-- saying "paid" for a job whose money left three weeks ago, and a crew is sent
-- out on it.
--
-- So the receipt is never edited and never deleted -- the money really was
-- taken on the day, and that is part of the job's history -- and what left is
-- written beside it. The readiness engine reads the difference.
--
-- Adjustments rather than a status on the payment, because a status cannot
-- hold a partial refund. Two hundred dollars back off an eight hundred dollar
-- deposit is not a state of the receipt, it is an amount, and the only honest
-- way to hold an amount is to write it down. external_id is unique, so the
-- same processor webhook delivered twice takes the money off once; that is
-- where Stripe's charge.refunded, charge.dispute.created and
-- payment_intent.canceled plug in when the route is built.
--
-- marketing_events is the other half of the same idea. A job going through its
-- life is the best marketing signal the business has: an evaluation booked on
-- a street means a van will be parked on it, a job finishing there means a
-- garden to photograph and forty neighbours who saw it. One opportunity per
-- job, kind and week, enforced here rather than by remembering to check --
-- so a retried event, a double webhook or four reschedules in a morning
-- update one row instead of printing five hundred door hangers.

CREATE TABLE IF NOT EXISTS public.payment_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('refund','chargeback','reversal','void','correction')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  external_id TEXT,
  recorded_by UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (external_id)
);
CREATE INDEX IF NOT EXISTS payment_adjustments_payment_idx ON public.payment_adjustments (payment_id);
CREATE INDEX IF NOT EXISTS payment_adjustments_job_idx ON public.payment_adjustments (job_id);

ALTER TABLE public.payment_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_adjustments_own_org ON public.payment_adjustments;
CREATE POLICY payment_adjustments_own_org ON public.payment_adjustments FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- Net valid money applied to one job. Existing receipts need no backfill: a
-- row with no adjustment against it counts in full, which is what they are.
CREATE OR REPLACE FUNCTION public.job_net_payments_cents(the_job UUID)
RETURNS BIGINT LANGUAGE sql STABLE SET search_path = public
AS $fn$
  SELECT coalesce(
    (SELECT sum(p.amount_cents) FROM payments p WHERE p.job_id = the_job AND p.received_at IS NOT NULL), 0)
  - coalesce(
    (SELECT sum(a.amount_cents) FROM payment_adjustments a
      JOIN payments p2 ON p2.id = a.payment_id
     WHERE p2.job_id = the_job), 0);
$fn$;

CREATE TABLE IF NOT EXISTS public.marketing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('evaluation_booked','job_scheduled','job_started','job_completed')),
  job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
  property_id UUID,
  customer_id UUID,
  zone_id UUID,
  window_start DATE NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, kind, window_start)
);
CREATE INDEX IF NOT EXISTS marketing_events_org_idx ON public.marketing_events (organization_id, kind, occurred_at DESC);
CREATE INDEX IF NOT EXISTS marketing_events_zone_idx ON public.marketing_events (zone_id);

ALTER TABLE public.marketing_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketing_events_own_org ON public.marketing_events;
CREATE POLICY marketing_events_own_org ON public.marketing_events FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

NOTIFY pgrst, 'reload schema';

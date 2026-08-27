-- What the client chose to do about paying, and what that means for booking.
--
-- Accepting used to be the end of the road: the status changed, an invoice
-- for the whole amount went out, and the client was looking at a thank-you.
-- Anybody who wanted to spread the cost had to ring up and ask, so the ones
-- who did not ring simply did not pay.
--
-- Acceptance now leads into the one question left, and the answer decides
-- when the crew gets booked, because those are the same decision.

alter table job_proposals add column if not exists payment_path text
  check (payment_path is null or payment_path in ('full', 'plan', 'plan_no_discount'));

comment on column job_proposals.payment_path is
  'How the client chose to pay after accepting. Null means they have accepted but not yet chosen, which is a job waiting on the client rather than on us.';

alter table job_proposals add column if not exists payment_path_at timestamptz;

-- ---------------------------------------------------------------------------
-- The condition the discount came with
-- ---------------------------------------------------------------------------
-- A discount is a discount for money up front. It survives as long as the
-- balance is cleared before the crew starts, which is why a plan that keeps
-- it books from the final payment rather than from today. Stored on the plan
-- rather than worked out later: it is a term somebody agreed to at a moment,
-- and a rule recomputed from today's settings is a rule nobody agreed to.
alter table payment_plans add column if not exists keeps_discount boolean not null default true;

comment on column payment_plans.keeps_discount is
  'Whether the proposal discount survives this plan. False when the client chose to start sooner and give it up.';

alter table payment_plans add column if not exists schedules_after_final_payment boolean not null default false;

comment on column payment_plans.schedules_after_final_payment is
  'Hold the booking until the balance is cleared. True only where a discount is being protected: a job that starts before the last payment has had the discount without the thing it was for.';

notify pgrst, 'reload schema';

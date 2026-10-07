-- A proposal the client can see is never worth nothing.
--
-- A quote went out at $0 because the design behind it had no pricing and
-- nobody looked at the total before pressing send. The app now refuses to
-- send, save or accept a proposal whose price after the discount is zero,
-- and this is the same rule at the database, so nothing can route around
-- it. NOT VALID: one accepted proposal from August already sits at zero
-- and is left as the record it is.

alter table job_proposals drop constraint if exists job_proposals_visible_price_positive;
alter table job_proposals add constraint job_proposals_visible_price_positive
  check (status not in ('sent', 'accepted') or coalesce(total_cost, 0) - coalesce(discount_amount, 0) > 0) not valid;

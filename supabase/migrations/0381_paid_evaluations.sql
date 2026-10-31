-- Booking no longer starts with a time. The client gives their details,
-- marks the map, sees their estimate, and then pays one of two ways before
-- anybody drives out:
--
--   deposit:    a third of the estimate, which holds the job and comes with
--               the basic evaluation visit;
--   evaluation: a paid evaluation at one of three tiers, whose fee comes off
--               the job if they go ahead (it is recorded against the job like
--               any payment, so the proposal's pay page asks for the rest).
--
-- Only then do they pick the visit time.

-- The tiers a business offers: [{ id, name, priceCents, blurb, includes }].
-- Null uses the app's defaults; any tier left out also falls back to them.
alter table organizations add column if not exists evaluation_tiers jsonb;

-- Which way they paid, and for what. The payment itself lands in payments.
alter table job_estimates add column if not exists choice text check (choice in ('deposit', 'evaluation'));
alter table job_estimates add column if not exists evaluation_tier text check (evaluation_tier in ('basic', 'measured', 'design'));
-- What the checkout was for, in cents, before the card fee.
alter table job_estimates add column if not exists charged_cents integer check (charged_cents >= 0);

-- Paid, whichever way. Was deposit_paid_at when the deposit was the only way.
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'job_estimates' and column_name = 'deposit_paid_at') then
    alter table job_estimates rename column deposit_paid_at to paid_at;
  end if;
end $$;

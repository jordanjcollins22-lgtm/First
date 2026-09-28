-- An advance is a balance the account manager owes, not a charge against a
-- project: paid out now, and paid back from their commission as it comes
-- due. So it needs no project, and a commission payout can say it went to
-- paying one back rather than to them.
alter table public.commission_advances alter column job_id drop not null;
alter table public.commission_payouts add column if not exists advance_repayment boolean not null default false;
comment on column public.commission_payouts.advance_repayment is
  'Commission kept to pay back an advance, not handed over. What is owed on advances is every paid advance less these.';
notify pgrst, 'reload schema';

-- The commission pool: 15% of what a project brings in, split 7% account
-- manager, 4% evaluator, 4% affiliate. Projects sold on or after this day are
-- split; ones sold before keep the deal they were sold on (the account
-- manager at their own rate).
alter table public.organizations
  add column if not exists commission_split_from date not null default date '2026-09-29';

comment on column public.organizations.commission_split_from is
  'Projects sold (proposal accepted) on or after this day pay commission from the 15% pool: 7% account manager, 4% evaluator, 4% affiliate.';

-- Which bucket a recurring charge belongs in.
--
-- The overhead is grouped so it can be acted on -- premises, vehicles,
-- insurance, utilities, software -- and most of it sorts itself from the
-- merchant name and the bank category. The biggest line does not. A landlord
-- trading as "YSI Fieldside" says nothing about being rent, so the single
-- largest cost in the business lands in "everything else" until somebody says
-- otherwise.
--
-- One tap, and it stays said. Beside the other judgements about the same
-- charge, because it is the same kind of thing: something the transactions
-- cannot know and a person can.
alter table recurring_decisions add column if not exists overhead_group text
  check (overhead_group is null or overhead_group in
    ('premises', 'vehicles', 'insurance', 'utilities', 'software', 'finance', 'other'));

comment on column recurring_decisions.overhead_group is
  'The overhead bucket somebody put this charge in. Null falls back to what the merchant name and bank category suggest.';

notify pgrst, 'reload schema';

-- Gas, water and the phone are three different questions.
--
-- They were one bucket called "utilities", which made the number useless. Gas
-- and electricity move with the weather and with how much is running; the
-- phone bill does not move at all; and the water is often not a separate bill
-- here because the landlord folds it into the rent some months. A single
-- figure covering all three says nothing about any of them.
--
-- Gas and electricity stay together on purpose. They arrive on one bill from
-- one supplier, and splitting them is not something a bank feed can do.
alter table recurring_decisions drop constraint if exists recurring_decisions_overhead_group_check;

update recurring_decisions set overhead_group = 'power' where overhead_group = 'utilities';

alter table recurring_decisions add constraint recurring_decisions_overhead_group_check
  check (overhead_group is null or overhead_group in
    ('premises', 'vehicles', 'insurance', 'power', 'water', 'phone', 'software', 'finance', 'other'));

comment on column recurring_decisions.overhead_group is
  'The overhead bucket somebody put this charge in. Null falls back to what the merchant name suggests. The bank''s own category is never used for this: it lumps rent, power, water and the phone together.';

notify pgrst, 'reload schema';

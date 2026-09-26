-- The terms of a credit card, which the bank feed does not tell us.
--
-- Balances arrive from the bank every morning, and a balance on its own
-- cannot answer the only questions worth asking about a card: what has to be
-- paid this month, by when, and which card costs the most to carry. Those
-- come from the statement, and on this account the bank's own liabilities
-- feed is not enabled — so they are typed in once and kept.
--
-- Nullable on purpose. A card with no terms set is not planned for and says
-- so on the screen, which is better than a plan built on a guessed interest
-- rate that quietly sends money to the wrong card.
alter table bank_accounts
  add column if not exists credit_limit numeric(12,2),
  add column if not exists apr numeric(6,3),
  add column if not exists minimum_payment numeric(12,2),
  add column if not exists payment_due_day smallint
    check (payment_due_day is null or (payment_due_day between 1 and 31));

comment on column bank_accounts.apr is
  'Annual rate as a percentage, e.g. 24.99. Decides which card surplus money goes to, since the dearest debt is the one worth clearing first.';
comment on column bank_accounts.minimum_payment is
  'What the statement demands this month. Paid before any card gets more than its minimum.';
comment on column bank_accounts.payment_due_day is
  'Day of the month the payment is due, 1 to 31. Used to order the minimums, so the nearest deadline is covered first.';

notify pgrst, 'reload schema';

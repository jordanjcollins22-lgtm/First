-- Card fees, and a stable key for anything imported into the ledger.
--
-- The payments import records what a client paid. What it could not record is
-- what the processor took on the way through: five thousand four hundred
-- pounds of card fees across one year's transactions, which is the difference
-- between money received and money kept. Without it every profit figure in
-- the app is high by that amount, and quietly.
--
-- Fees belong in the ledger as an expense rather than being netted off the
-- payment. What the client paid is what the client paid; the fee is something
-- the business spent to take it, and burying it inside the receipt is how it
-- stops being visible.
--
-- The external id is the same idea as on payments: an import has to be
-- re-runnable, and a ledger that gains a second copy of every fee each time
-- somebody presses the button is worse than one with no fees in it.

alter table ledger_entries add column if not exists external_id text;

create unique index if not exists ledger_entries_org_external_id_key
  on ledger_entries(organization_id, external_id);

comment on column ledger_entries.external_id is
  'Stable key for an imported entry, so re-running an import updates rather than duplicating. Null on anything typed in by hand.';

-- 'processing_fees' is new. The constraint has to be rebuilt to admit it,
-- and is rebuilt in full rather than patched so it stays readable.
alter table ledger_entries drop constraint if exists ledger_entries_direction_category;
alter table ledger_entries drop constraint if exists ledger_entries_category_check;

alter table ledger_entries
  add constraint ledger_entries_direction_category check (
    (direction = 'in' and category in ('job_payment', 'deposit', 'other_income'))
    or (
      direction = 'out'
      and category in (
        'materials', 'subcontractor', 'fuel', 'equipment', 'permit',
        'processing_fees', 'other_expense'
      )
    )
  );

notify pgrst, 'reload schema';

-- A ledger entry can be owed and not yet paid.
--
-- A subcontractor finishes on a Tuesday and is paid on Friday. Until now the
-- books could hold only the Friday: the Tuesday cost was written nowhere,
-- or written as paid three days early, and either way the bill to settle was
-- in somebody's head. `paid_on` is when the money actually moved; null means
-- it has not, and the entry is a bill still to pay. Every existing row was
-- recorded when the money moved, so its paid date is its date.

ALTER TABLE public.ledger_entries ADD COLUMN IF NOT EXISTS paid_on date;
UPDATE public.ledger_entries SET paid_on = occurred_on WHERE paid_on IS NULL;
CREATE INDEX IF NOT EXISTS ledger_entries_owed_idx ON public.ledger_entries (organization_id) WHERE paid_on IS NULL;

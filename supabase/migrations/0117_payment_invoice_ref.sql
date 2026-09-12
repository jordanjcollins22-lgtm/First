-- The invoice a payment came from, whoever raised it.
--
-- Payments already carry stripe_invoice_id, and that column means exactly
-- what it says: an `in_...` id belonging to a Stripe invoice. The money this
-- business has actually taken was invoiced somewhere else — the charges carry
-- a GoHighLevel invoice id in their metadata — and putting one of those in a
-- column named for Stripe would be a lie that reads like a fact. The webhook
-- matches instalments on stripe_invoice_id; a foreign id sitting in it is a
-- match waiting to happen against the wrong row.
--
-- So: a second column that says what it is. Which invoice, in whatever system
-- raised it. Grouping reads both.

alter table payments add column if not exists source_invoice_ref text;

comment on column payments.source_invoice_ref is
  'The invoice this payment settled, in whichever system raised it (GoHighLevel, a paper book, Stripe). Not a Stripe id — that is stripe_invoice_id. Two payments sharing this are one piece of work.';

-- The only query this column exists for: gather the payments that settled one
-- invoice. Partial, because most rows have nothing to gather.
create index if not exists payments_source_invoice_idx
  on payments(source_invoice_ref) where source_invoice_ref is not null;

notify pgrst, 'reload schema';

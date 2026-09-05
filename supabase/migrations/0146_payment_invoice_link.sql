-- Which bill a payment settled.
--
-- Payments knew the contact, the job, the plan and the instalment. Not the
-- invoice -- so an invoice could never know it had been paid. Its status came
-- from somebody ticking a box by hand, or from what the exporting system
-- claimed months ago, and money arriving against it changed nothing on the
-- screen.
--
-- With the link, paid becomes something the invoice works out rather than
-- something somebody remembers to record: the payments against it add up to
-- what it asked for, or they do not. A stored "paid" flag is a second thing to
-- keep in step and it starts lying the first time a payment is corrected.
--
-- Null on everything that came before. The historical import cannot be joined
-- -- the payments export carries the source system's internal invoice id and
-- the invoice export carries the human invoice number, and neither file has
-- both -- so those keep reading from what the source said. This is for
-- everything from here on.

alter table payments
  add column if not exists invoice_id uuid references client_invoices(id) on delete set null;

comment on column payments.invoice_id is
  'The invoice this payment settles, where it is known. Null for money not raised against a bill in this app.';

-- The lookup behind an invoice showing what has been paid against it.
create index if not exists payments_invoice_idx
  on payments (invoice_id) where invoice_id is not null;

notify pgrst, 'reload schema';

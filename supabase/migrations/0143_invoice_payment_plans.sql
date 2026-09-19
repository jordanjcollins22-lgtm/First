-- A payment plan against the invoice it settles.
--
-- A plan already knows the job it is for, the proposal it came from and the
-- contact who owes it. What it could not say is which bill it pays off, and
-- that is the one somebody actually holds in their hand: a client rings about
-- invoice 1042 and asks to pay it over three months.
--
-- Without the link the two facts sit apart. The invoice says $4,520 owed since
-- May and shouts overdue; the plan says three payments of $1,506 and the first
-- is not due yet. Both are on the screen, neither knows about the other, and
-- the office is left deciding which one to believe.
--
-- Nullable, because most plans are still agreed against a job or a proposal
-- rather than a bill, and on delete set null because deleting the file of an
-- invoice should not take the schedule of payments with it -- the money is
-- the part that matters.

alter table payment_plans
  add column if not exists invoice_id uuid references client_invoices(id) on delete set null;

comment on column payment_plans.invoice_id is
  'The invoice this plan pays off, when it was agreed against a bill rather than a job. Null otherwise.';

-- The lookup behind an invoice showing its own schedule.
create index if not exists payment_plans_invoice_idx
  on payment_plans (invoice_id) where invoice_id is not null;

notify pgrst, 'reload schema';

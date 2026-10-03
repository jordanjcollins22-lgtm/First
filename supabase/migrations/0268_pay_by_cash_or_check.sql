-- Paying by cash or check.
--
-- A client who would rather not pay the card fee can say so on the pay
-- screen. That is a choice of how to pay, recorded on the proposal like the
-- others, and a bill waiting to be collected, recorded on the invoice: who
-- asked for what, and later who picked it up. The account manager hears
-- about it the moment it is chosen and marks the pickup in the app.

alter table job_proposals drop constraint if exists job_proposals_payment_path_check;
alter table job_proposals add constraint job_proposals_payment_path_check
  check (payment_path is null or payment_path in ('full', 'plan', 'plan_no_discount', 'cash_check'));

alter table invoices
  add column if not exists pay_by text check (pay_by in ('cash', 'check')),
  add column if not exists pay_by_requested_at timestamptz,
  add column if not exists collected_by uuid references profiles(id) on delete set null,
  add column if not exists collected_note text;

create index if not exists invoices_to_collect_idx on invoices(organization_id) where status = 'open' and pay_by is not null;

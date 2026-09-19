-- A receipt: proof that money arrived.
--
-- The system has always known when it did. Nearly a hundred payments are on
-- file and nobody outside the office could see any of them, because there
-- was nothing to hand a client afterwards. A client who paid cash on a
-- driveway and got nothing back has to trust that somebody wrote it down,
-- and the one who rings in March asking what they paid in November gets an
-- answer out of somebody's memory.
--
-- One receipt per payment, numbered once and never reused, with its own token
-- because the client holding it has no account. The number is year-first so
-- a year files together and reads as its own context over the phone.
alter table payments
  add column if not exists receipt_number text,
  add column if not exists receipt_token text,
  add column if not exists receipt_issued_at timestamptz,
  add column if not exists receipt_sent_at timestamptz;

comment on column payments.receipt_number is
  'R-YYYY-NNNN, issued once per payment and never reused. Null until somebody writes the receipt.';
comment on column payments.receipt_token is
  'The whole of a client''s access to their receipt page. They have no account.';

create unique index if not exists payments_receipt_token_idx
  on payments (receipt_token) where receipt_token is not null;
create unique index if not exists payments_receipt_number_idx
  on payments (organization_id, receipt_number) where receipt_number is not null;

notify pgrst, 'reload schema';

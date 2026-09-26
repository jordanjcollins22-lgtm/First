-- The part of a payment that was the card fee rather than the work.
--
-- A card surcharge arrives inside the total: the client pays the price plus
-- three and a half percent, and the bank sees one number. That number is what
-- has to reconcile, so it stays on amount_cents.
--
-- But it is not what the job earned. Without the split, a $4,520 job paid by
-- card records $4,678.20 against a client billed $4,520, and every screen that
-- compares billed with banked reads the difference as an overpayment. Revenue
-- would drift upward by the exact amount the processor is about to take.
--
-- Null on everything that came before, and on anything paid by cash, cheque or
-- transfer, where there was no fee to separate out.

alter table payments add column if not exists surcharge_cents bigint;

comment on column payments.surcharge_cents is
  'The card processing surcharge inside amount_cents. Null when there was none. What the work earned is amount_cents minus this.';

notify pgrst, 'reload schema';

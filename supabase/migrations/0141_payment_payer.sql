-- Who the payment said it was from.
--
-- An imported payment that could not be matched to a contact used to keep
-- nothing about the payer: the row landed with a null customer and the name
-- and email that came with it were thrown away. So the money sat on a screen
-- as "no contact" with no way to work out whose it was short of finding the
-- original export and running it again.
--
-- The file always knew. It carried a name, usually an email, often a phone,
-- and those are exactly what is needed to find the person or make them. Kept
-- on the row, an orphaned payment can be reconciled at any point afterwards
-- by somebody who never sees the CSV.

alter table payments add column if not exists payer_name text;
alter table payments add column if not exists payer_email text;
alter table payments add column if not exists payer_phone text;

comment on column payments.payer_email is
  'What the payment export said the payer''s email was. Kept so a payment with no contact can be matched up later without the original file.';

-- The lookup behind "match these up": every payment with no contact on it.
create index if not exists payments_unmatched_idx
  on payments (organization_id) where customer_id is null;

notify pgrst, 'reload schema';

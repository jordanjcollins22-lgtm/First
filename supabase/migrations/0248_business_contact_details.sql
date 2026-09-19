-- What the business puts at the top of a document.
--
-- A receipt, a proposal and an invoice all need the same four lines: who we
-- are, where we are, how to reach us. None of it was stored. The receipt
-- page shipped with the business name and nothing under it, which reads as a
-- form letter rather than a document from a company somebody can ring.
--
-- Stored on the organisation rather than typed into each document, so the
-- phone number is changed once and every document after it is right.
alter table organizations
  add column if not exists business_phone text,
  add column if not exists business_email text,
  add column if not exists business_address text,
  add column if not exists business_website text,
  add column if not exists logo_path text;

comment on column organizations.business_address is
  'Postal address as it should print on a document. Free text, line breaks kept.';
comment on column organizations.logo_path is
  'Path in the public bucket, or under /public. Null prints the business name as a wordmark instead.';

notify pgrst, 'reload schema';

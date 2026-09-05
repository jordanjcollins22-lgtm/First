-- Invoices brought in from wherever they were raised.
--
-- The table was built for a file somebody uploads: a PDF, with the numbers
-- typed in beside it. An export has the opposite shape -- every number and no
-- file at all -- and both are real invoices. So the file becomes optional.
--
-- The scope comes with them, which is the part worth more than the number. The
-- exporting system carries the whole written scope of work on each invoice,
-- and that is what a rewrite of an old quote is built from. It is HTML from a
-- rich text editor; it is stored as it came rather than flattened, because
-- guessing at somebody's paragraph breaks loses the shape of what was sold.
--
-- What the source called the status is stored as what it is: the exporting
-- system's own claim, not a fact this app worked out. Ordinarily paid-ness is
-- derived from money received, but the payments export and the invoice export
-- share no key -- payments carry the source system's internal invoice id and
-- the invoice export carries the human invoice number, and neither file has
-- both. Without that join the file's own word is the best evidence there is,
-- and it is recorded under a name that says so.

alter table client_invoices alter column file_path drop not null;
alter table client_invoices alter column file_name drop not null;

alter table client_invoices add column if not exists title text;
alter table client_invoices add column if not exists scope_html text;
alter table client_invoices add column if not exists subtotal numeric;
alter table client_invoices add column if not exists discount numeric;
alter table client_invoices add column if not exists source_status text;
alter table client_invoices add column if not exists source text;
alter table client_invoices add column if not exists external_id text;

comment on column client_invoices.scope_html is
  'The written scope from the invoice, as the exporting system stored it. What a rewritten quote is built from.';
comment on column client_invoices.source_status is
  'What the system it came from said: paid, overdue, partially paid. An external claim rather than something derived here.';
comment on column client_invoices.discount is
  'What was taken off the subtotal. Kept because a total that does not equal the subtotal otherwise looks like an error.';
comment on column client_invoices.external_id is
  'The exporting system''s own invoice number. The conflict target the import upserts on, so re-running a file updates rather than duplicating.';

-- A plain unique index rather than a partial one, for the reason 0136 spells
-- out: Postgres will not infer a partial index as an ON CONFLICT target unless
-- the statement repeats the predicate, and PostgREST cannot send one. A unique
-- index never treats two nulls as equal, so invoices with no external id --
-- every one somebody uploaded by hand -- are unaffected.
create unique index if not exists client_invoices_org_external_id_key
  on client_invoices (organization_id, external_id);

notify pgrst, 'reload schema';

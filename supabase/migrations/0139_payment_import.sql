-- Payments brought in from wherever the money was actually taken.
--
-- The payments table already holds what this needs. What it lacked was a
-- stable key from the exporting system, so running the same file twice paid
-- everybody twice.
--
-- A plain unique index rather than a partial one, for the reason 0136 spells
-- out: Postgres will not infer a partial index as an ON CONFLICT target
-- unless the statement repeats the predicate, and PostgREST cannot send one.
-- A unique index never treats two nulls as equal, so rows with no external id
-- -- every payment somebody typed in by hand -- are unaffected.

alter table payments add column if not exists external_id text;
alter table payments add column if not exists source text;

create unique index if not exists payments_org_external_id_key
  on payments(organization_id, external_id);

comment on column payments.external_id is
  'The exporting system''s own transaction id. The conflict target the payment import upserts on, so re-running a file updates rather than duplicates.';
comment on column payments.source is
  'Where this came from: an import name, or null for one recorded in the app.';

notify pgrst, 'reload schema';

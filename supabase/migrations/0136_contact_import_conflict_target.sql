-- The index the contact import upserts onto.
--
-- Re-importing a CRM export has to update the people it already knows rather
-- than add second copies of them, and the honest way to say that is one
-- statement per few hundred rows that inserts or updates on the CRM's own id.
-- Postgres will only resolve that against an index it can infer from the
-- conflict target, and it refuses to infer a *partial* index unless the
-- statement repeats the index's condition word for word — which PostgREST,
-- which is what the app actually speaks to, has no way to express.
--
-- So the same uniqueness is stated as a plain index. Nothing about what is
-- allowed changes: a unique index never considers two nulls equal, so rows
-- with no external id were never constrained by the partial one either, and
-- the "where external_id is not null" it carried only ever saved space.
--
-- Without this, an import that means to update falls back to inserting, which
-- is how a contact book ends up with everybody in it twice.

create unique index if not exists customers_org_external_id_key
  on customers(organization_id, external_id);

-- Redundant the moment the index above exists, and an index maintained on
-- every write for nothing is a cost paid forever.
drop index if exists customers_external_id_idx;

comment on index customers_org_external_id_key is
  'One contact per CRM id per organisation. Named as the conflict target by the contact import, which is why it is a plain index rather than a partial one.';

notify pgrst, 'reload schema';

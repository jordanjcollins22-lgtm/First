-- Merging a contact deletes one. This is how to get it back.
--
-- A merge moves the duplicate's properties onto the keeper, fills the keeper's
-- blanks from it, and then deletes it. Every part of that is right, and the
-- last part is irreversible: the name, the tags, the CRM id, the pipeline
-- stage and the row's own identity are gone, and there is no record of which
-- properties moved or which blanks were filled.
--
-- That was tolerable while merges were occasional and hand-checked. It stops
-- being tolerable the moment a few thousand imported contacts arrive and the
-- duplicate list has hundreds of pairs on it — because then somebody is
-- merging quickly, and merging quickly means merging one wrong.
--
-- So every merge writes down enough to be undone: the whole deleted row, which
-- properties moved, and which fields were filled in on the keeper.

create table if not exists contact_merges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),

  -- The survivor. Not a foreign key: if it is later deleted the record of what
  -- happened should outlive it rather than vanish with it.
  kept_id uuid not null,
  kept_name text not null,

  -- The whole deleted row, as it was. A snapshot rather than columns, because
  -- a contact gains columns over time and an undo written against the shape of
  -- 2026 should still restore a row written today.
  merged_snapshot jsonb not null,
  merged_name text not null,

  -- Which properties changed hands, so an undo moves back exactly those and
  -- not any the keeper already had.
  moved_property_ids uuid[] not null default '{}',

  -- What the merge filled in on the keeper, so an undo can empty those again
  -- without touching anything somebody has typed since.
  patched_fields jsonb not null default '{}',

  merged_by uuid references profiles(id),
  merged_at timestamptz not null default now(),

  undone_at timestamptz,
  undone_by uuid references profiles(id)
);

create index if not exists contact_merges_recent_idx
  on contact_merges(organization_id, merged_at desc);

alter table contact_merges enable row level security;

drop policy if exists "org_scoped_contact_merges" on contact_merges;
create policy "org_scoped_contact_merges" on contact_merges for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';

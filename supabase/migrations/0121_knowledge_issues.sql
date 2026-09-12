-- Problems on the graph, and what solves them.
--
-- Everything on the knowledge graph so far is a thing the business has or
-- does. There was nowhere to put a thing that is wrong — the trailer gate
-- that does not latch, the route that wastes forty minutes, the material
-- nobody local stocks. Those went in people's heads, which is where problems
-- go to be forgotten and rediscovered.
--
-- An issue is a flag rather than a type, because a problem is always a
-- problem *about* something: a piece of equipment, a process, a supplier. It
-- keeps its own kind, and gets marked as broken on top.

alter table knowledge_nodes add column if not exists is_issue boolean not null default false;

comment on column knowledge_nodes.is_issue is
  'Something that is wrong and needs solving. Drawn red until a solution is linked. Deliberately a flag, not a node_type — a problem is always a problem about something, and that something keeps its own kind.';

-- The work list: every problem nobody has answered yet.
create index if not exists knowledge_nodes_open_issues_idx
  on knowledge_nodes(organization_id) where is_issue;

-- ---------------------------------------------------------------------------
-- A picture of it
-- ---------------------------------------------------------------------------
-- Mostly for issues, where a photo of the bent gate settles in one glance
-- what a paragraph argues about. Available on every node because a photo of
-- the right part number is worth the same.
alter table knowledge_nodes add column if not exists image_path text;

comment on column knowledge_nodes.image_path is
  'A photo in the knowledge-images bucket. On an issue this is usually the fastest description of the problem there is.';

insert into storage.buckets (id, name, public)
values ('knowledge-images', 'knowledge-images', true)
on conflict (id) do nothing;

drop policy if exists "read_knowledge_images" on storage.objects;
create policy "read_knowledge_images"
  on storage.objects for select to authenticated
  using (bucket_id = 'knowledge-images');

drop policy if exists "write_knowledge_images" on storage.objects;
create policy "write_knowledge_images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'knowledge-images');

drop policy if exists "update_knowledge_images" on storage.objects;
create policy "update_knowledge_images"
  on storage.objects for update to authenticated
  using (bucket_id = 'knowledge-images');

drop policy if exists "delete_knowledge_images" on storage.objects;
create policy "delete_knowledge_images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'knowledge-images');

-- ---------------------------------------------------------------------------
-- What solves it
-- ---------------------------------------------------------------------------
-- A new edge kind rather than reusing 'enables' or 'replaces'. Whether an
-- issue is still open is read off these edges, so the answer has to come from
-- an edge that means only this — 'related_to' between a problem and an idea
-- says somebody was thinking about it, not that they fixed it.
--
-- The constraint is rebuilt rather than added to, because a CHECK holds one
-- list and there is no way to append to it in place. Existing rows all match
-- a value that is still in the list, so nothing is orphaned by this.
alter table knowledge_relationships
  drop constraint if exists knowledge_relationships_relationship_type_check;

alter table knowledge_relationships
  add constraint knowledge_relationships_relationship_type_check
  check (relationship_type in (
    'uses','requires','produces','depends_on','similar_to','shares_resource_with',
    'can_be_combined_with','enables','replaces','leads_to','sold_through',
    'purchased_from','performed_by','used_by','located_at','requires_skill',
    'requires_equipment','requires_material','has_cost','generates_revenue',
    'part_of','parent_of','child_of','related_to','solved_by'
  ));

notify pgrst, 'reload schema';

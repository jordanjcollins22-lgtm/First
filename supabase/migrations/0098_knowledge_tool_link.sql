-- The rest of the inventory.
--
-- A node could be linked to a material and nothing else, which quietly meant
-- half the inventory did not exist as far as the graph was concerned. The
-- printer an idea runs through is a tool. So are the mower, the blower and
-- the crew's gear, and an idea that needs one of them needs it whichever
-- table it happens to live in.

alter table knowledge_nodes add column if not exists tool_id uuid references tools(id) on delete set null;

comment on column knowledge_nodes.tool_id is
  'Linked inventory tool or crew gear. Like material_id, its cost and purchase link win over anything on the node.';

create index if not exists knowledge_nodes_tool_idx on knowledge_nodes(tool_id)
  where tool_id is not null;

-- One or the other, never both: two prices for one node is the thing all of
-- this exists to stop.
alter table knowledge_nodes drop constraint if exists knowledge_nodes_one_inventory_link;
alter table knowledge_nodes add constraint knowledge_nodes_one_inventory_link
  check (material_id is null or tool_id is null);

notify pgrst, 'reload schema';

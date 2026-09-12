-- Bought again, or bought once.
--
-- The graph has been guessing this from the kind of thing something is:
-- a tool is kit, a material is used up. That is right most of the time and
-- wrong in the cases that cost money. A pallet of cardstock is a material and
-- gets used up. A sign frame is a material in inventory and gets put back in
-- the truck at the end of the day — charging it to every run overstates every
-- campaign that uses it, which is the double charge this exists to stop.
--
-- So it becomes something somebody says out loud when they add it, rather than
-- something the app infers from a dropdown they were not thinking about.

alter table knowledge_nodes add column if not exists cost_basis text;
alter table knowledge_nodes drop constraint if exists knowledge_nodes_cost_basis_check;
alter table knowledge_nodes add constraint knowledge_nodes_cost_basis_check
  check (cost_basis is null or cost_basis in ('consumable', 'capital'));

comment on column knowledge_nodes.cost_basis is
  'consumable = bought again every run. capital = bought once and kept, charged once however many things use it. Null falls back to what the node type implies.';

notify pgrst, 'reload schema';

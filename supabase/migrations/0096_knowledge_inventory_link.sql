-- Ideas that point at real things you can actually buy.
--
-- The graph knowing "cardstock, twelve cents a sheet" is useful right up
-- until somebody has to order it, at which point the useful thing is the
-- material in the inventory: what it costs today, how many are left, where
-- it is stored and the link to the page you buy it from.
--
-- So a node can be linked to a material rather than describing one. Linked,
-- the material is the price — one number, in the place the rest of the
-- business already keeps it, instead of a second copy in the graph that
-- drifts the first time somebody's supplier puts prices up.

-- Marketing stock is inventory, but it is not job inventory. Door hangers
-- have no business appearing in the material list an estimator picks from
-- while pricing a patio, so it is a category rather than a separate table:
-- the ordering, stock levels, storage and reorder alerts are all the same
-- problem and deserve the same screen.
alter table materials add column if not exists category text not null default 'job';
alter table materials drop constraint if exists materials_category_check;
alter table materials add constraint materials_category_check
  check (category in ('job','marketing'));

comment on column materials.category is
  'job = used on site and quotable. marketing = door hangers, flyers, signs. Same inventory, different list.';

create index if not exists materials_category_idx on materials(organization_id, category, active);

-- Where you buy it, for something the graph is tracking on its own.
alter table knowledge_nodes add column if not exists purchase_url text;

-- Or, better, the real material — in which case the material is the price.
alter table knowledge_nodes add column if not exists material_id uuid references materials(id) on delete set null;

comment on column knowledge_nodes.material_id is
  'Linked inventory material. When set, its cost and purchase link win over the ones on the node — one price, in one place.';

create index if not exists knowledge_nodes_material_idx on knowledge_nodes(material_id)
  where material_id is not null;

notify pgrst, 'reload schema';

-- What an idea actually costs.
--
-- Breaking "door hangers" down into cardstock, toner and design time is only
-- half an answer. The other half is that it is 2,000 sheets, one toner
-- cartridge and four hours, and that those numbers are what turn a good idea
-- into one somebody can decide about.
--
-- Two pieces, in two places, because they belong to different things. What a
-- sheet of cardstock costs belongs to the cardstock — it is the same price
-- whoever is buying it. How many sheets belongs to the connection, because
-- door hangers need two thousand and postcards need five hundred.

-- Cost per unit lives on the node. estimated_cost already existed and was
-- never surfaced anywhere, so it becomes the per-unit price rather than
-- shipping a second cost column nobody could tell apart from the first.
comment on column knowledge_nodes.estimated_cost is
  'Cost of one unit — one sheet, one hour, one bag. Multiplied by the quantity on each connection.';

alter table knowledge_nodes add column if not exists unit text not null default 'each';
alter table knowledge_nodes drop constraint if exists knowledge_nodes_unit_check;
alter table knowledge_nodes add constraint knowledge_nodes_unit_check
  check (unit in (
    'each','hour','day','week','month','sheet','box','pack','bag','roll',
    'gallon','pound','ton','ft','sq ft','yard','mile','job','visit'
  ));

comment on column knowledge_nodes.unit is
  'What one of it is. An hour or a day makes this time rather than materials, which is how the two totals stay apart.';

-- How much of it this particular idea needs.
alter table knowledge_relationships add column if not exists quantity numeric;
alter table knowledge_relationships drop constraint if exists knowledge_relationships_quantity_check;
alter table knowledge_relationships add constraint knowledge_relationships_quantity_check
  check (quantity is null or quantity >= 0);

comment on column knowledge_relationships.quantity is
  'How many units of the target this connection needs. Null means nobody has said yet, which costs nothing rather than guessing.';

notify pgrst, 'reload schema';

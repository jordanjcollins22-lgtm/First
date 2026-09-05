-- One price, and it lives in inventory.
--
-- knowledge_nodes.estimated_cost was the graph's own copy of what something
-- cost. It is no longer written or read: a number typed into an idea board
-- outlives whatever it was guessing about, and two prices for one material is
-- worse than one price and an honest gap.
--
-- Kept rather than dropped, because dropping a column is the one migration
-- that cannot be undone by running the next one.

comment on column knowledge_nodes.estimated_cost is
  'Unused. Cost comes from the linked material in inventory — see material_id. Left in place rather than dropped.';

comment on column knowledge_nodes.unit is
  'What one of it is, for reading quantities and for telling time from materials. The price is the material''s, not this.';

notify pgrst, 'reload schema';

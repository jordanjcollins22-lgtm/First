-- Adds a quantity-on-hand column so the Tool Database also works as an
-- inventory tracker, not just a catalog.

alter table tools add column if not exists quantity integer;

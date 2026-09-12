-- Adds ordering/reorder tracking to materials: a link to buy it, how much is
-- on hand, a reorder threshold to flag when it's time to order, and a flag
-- for "an order has been placed, waiting for it to come in."

alter table materials add column if not exists purchase_url text;
alter table materials add column if not exists quantity_on_hand numeric(10, 2);
alter table materials add column if not exists reorder_threshold numeric(10, 2);
alter table materials add column if not exists on_order boolean not null default false;

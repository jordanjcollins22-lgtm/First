-- Gives tools the same low-stock/reorder tracking materials already have:
-- a reorder threshold and an on_order flag ("bought or rented, waiting on
-- it"). The action button reads "Buy" or "Rent" depending on the tool's
-- existing is_rental flag.

alter table tools add column if not exists reorder_threshold integer;
alter table tools add column if not exists on_order boolean not null default false;

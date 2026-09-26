-- Every tool/material now answers two explicit questions when it's added:
-- "is it stored at our warehouse, or do we order it as needed?" (stock_method
-- — replaces inferring this from quantity alone) and "do we get it
-- delivered?" (is_delivered). stock_method drives whether storage_location
-- is required, same rule as before but now explicit instead of implied by
-- quantity > 0.
alter table tools add column if not exists stock_method text not null default 'in_stock';
alter table tools drop constraint if exists tools_stock_method_check;
alter table tools add constraint tools_stock_method_check
  check (stock_method in ('in_stock', 'order_as_needed'));
alter table tools add column if not exists is_delivered boolean not null default false;

alter table materials add column if not exists stock_method text not null default 'in_stock';
alter table materials drop constraint if exists materials_stock_method_check;
alter table materials add constraint materials_stock_method_check
  check (stock_method in ('in_stock', 'order_as_needed'));
alter table materials add column if not exists is_delivered boolean not null default false;

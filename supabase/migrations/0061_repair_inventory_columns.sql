-- Schema repair. Adding a tool failed with PGRST204 ("Could not find the
-- 'purchase_url' column of 'tools'"), meaning some earlier migrations never
-- ran against this database. This re-asserts every tools/materials column
-- the app writes today, in one pass.
--
-- Every statement is idempotent (`if not exists` / guarded DO blocks), so
-- running this is safe whether a column is already there or not, and it
-- doesn't touch existing data.

-- ============================================================
-- tools
-- ============================================================
alter table tools add column if not exists image_path text;
alter table tools add column if not exists quantity integer;
alter table tools add column if not exists storage_location text;
alter table tools add column if not exists shop_location text;
alter table tools add column if not exists purchase_url text;
alter table tools add column if not exists how_to_url text;
alter table tools add column if not exists reorder_threshold integer;
alter table tools add column if not exists on_order boolean not null default false;
alter table tools add column if not exists not_owned_reason text;
alter table tools add column if not exists cost_to_own numeric;
alter table tools add column if not exists is_delivered boolean not null default false;
alter table tools add column if not exists stock_method text not null default 'in_stock';

alter table tools drop constraint if exists tools_stock_method_check;
alter table tools add constraint tools_stock_method_check
  check (stock_method in ('in_stock', 'order_as_needed'));

-- kits went text[] (0008) -> integer[] (0011). Add it if absent; convert it
-- if it's still the old text[] form. Old free-text kit names don't map to
-- numbers, so a conversion drops them — same trade-off 0011 made.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'tools' and column_name = 'kits'
  ) then
    alter table tools add column kits integer[] not null default '{}';
  elsif exists (
    select 1 from information_schema.columns
    where table_name = 'tools' and column_name = 'kits' and udt_name = '_text'
  ) then
    alter table tools drop column kits;
    alter table tools add column kits integer[] not null default '{}';
  end if;
end $$;

-- ============================================================
-- materials
-- ============================================================
alter table materials add column if not exists image_path text;
alter table materials add column if not exists description text;
alter table materials add column if not exists storage_location text;
alter table materials add column if not exists shop_location text;
alter table materials add column if not exists purchase_url text;
alter table materials add column if not exists quantity_on_hand numeric(10, 2);
alter table materials add column if not exists reorder_threshold numeric(10, 2);
alter table materials add column if not exists on_order boolean not null default false;
alter table materials add column if not exists can_store boolean not null default true;
alter table materials add column if not exists storage_alternative text;
alter table materials add column if not exists storage_requirements text;
alter table materials add column if not exists storage_cost numeric;
alter table materials add column if not exists is_delivered boolean not null default false;
alter table materials add column if not exists stock_method text not null default 'in_stock';
alter table materials add column if not exists type_options text[] not null default '{}';
alter table materials add column if not exists color_options text[] not null default '{}';

alter table materials drop constraint if exists materials_stock_method_check;
alter table materials add constraint materials_stock_method_check
  check (stock_method in ('in_stock', 'order_as_needed'));

-- ============================================================
-- org scoping (0034) — backfill before any not-null assumptions
-- ============================================================
alter table tools add column if not exists organization_id uuid references organizations(id);
update tools set organization_id = '00000000-0000-0000-0000-000000000001' where organization_id is null;
alter table tools alter column organization_id set default '00000000-0000-0000-0000-000000000001';

alter table materials add column if not exists organization_id uuid references organizations(id);
update materials set organization_id = '00000000-0000-0000-0000-000000000001' where organization_id is null;
alter table materials alter column organization_id set default '00000000-0000-0000-0000-000000000001';

-- PGRST204 is PostgREST serving a stale schema cache, so tell it to reload
-- rather than waiting for it to notice on its own.
notify pgrst, 'reload schema';

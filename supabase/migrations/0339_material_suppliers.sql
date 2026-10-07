-- Bulk material suppliers near the work, and what they sell by the yard or
-- ton, so a price can name the closest one with a price and what delivery
-- costs.
--
-- A supplier is a place: its address and position, phone and website, and
-- what it charges to deliver. Delivery fees vary by where the load goes, so
-- they are kept as a list of towns with their zip codes and the fee to each;
-- a minimum order (3 yards is usual) and anything the fee table can't say go
-- in the notes. Prices come off the supplier's own website and are dated, so
-- a stale one can be seen for what it is. A supplier with no prices yet is
-- still worth keeping: when it is the closer one, the card says to call it.
create table if not exists material_suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  address text,
  lat double precision,
  lng double precision,
  phone text,
  website text,
  delivers boolean not null default true,
  -- In yards (or tons, for stone): the smallest order they will deliver.
  delivery_minimum numeric check (delivery_minimum is null or delivery_minimum > 0),
  -- [{ "town": "Bel Air", "zips": ["21014", "21015"], "fee_cents": 4000 }]
  delivery_fees jsonb not null default '[]'::jsonb check (jsonb_typeof(delivery_fees) = 'array'),
  delivery_note text,
  notes text,
  -- Where the prices were read, and when.
  source_url text,
  checked_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists material_suppliers_org_idx on material_suppliers (organization_id);

comment on table material_suppliers is
  'Bulk material suppliers (mulch, topsoil, stone): where they are, delivery fees by town and the delivery minimum.';

create table if not exists supplier_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  supplier_id uuid not null references material_suppliers(id) on delete cascade,
  -- What it is used as, matched to the services: mulch install uses mulch.
  kind text not null check (kind in ('mulch', 'topsoil', 'stone', 'compost', 'sand', 'other')),
  name text not null check (length(trim(name)) > 0),
  unit text not null default 'yd' check (unit in ('yd', 'ton')),
  -- Picked up. Null when the supplier doesn't publish a price.
  price_cents integer check (price_cents is null or price_cents >= 0),
  -- Some charge more a yard when it is delivered, on top of the delivery fee.
  delivered_price_cents integer check (delivered_price_cents is null or delivered_price_cents >= 0),
  image_url text,
  product_url text,
  checked_on date,
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists supplier_products_supplier_idx on supplier_products (supplier_id);
create index if not exists supplier_products_org_kind_idx on supplier_products (organization_id, kind);

comment on table supplier_products is
  'What each bulk supplier sells by the yard or ton, with its price, photo and link, and when the price was read.';

alter table material_suppliers enable row level security;
alter table supplier_products enable row level security;

-- Everyone in the business reads them, since prices are worked out from
-- them. Changes go through the server, which checks for an owner or admin.
create policy material_suppliers_read on material_suppliers
  for select to authenticated
  using (organization_id = current_org_id());

create policy supplier_products_read on supplier_products
  for select to authenticated
  using (organization_id = current_org_id());

notify pgrst, 'reload schema';

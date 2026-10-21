-- Team store: team members order custom merch (e.g. a magnet with their own
-- barcode). We own the design; an outside print vendor makes and ships it.

create table if not exists merch_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  -- SVG with a <rect id="barcode-slot">, the only part that changes per order.
  design_svg text not null,
  barcode_format text not null default 'code128'
    check (barcode_format in ('code128', 'qrcode', 'upca', 'ean13')),
  price_cents integer not null default 0 check (price_cents >= 0),
  vendor_name text,
  vendor_sku text,
  print_specs text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists merch_orders (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references merch_products(id) on delete restrict,
  team_member_id uuid not null references team_members(id) on delete restrict,
  quantity integer not null default 1 check (quantity between 1 and 500),
  barcode_value text not null,
  -- The exact file sent to the vendor, frozen when the order is placed.
  print_svg text not null,
  ship_to jsonb not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'sent_to_vendor', 'shipped', 'delivered', 'cancelled')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'paid', 'payroll_deduction', 'company_paid')),
  vendor_order_ref text,
  tracking_number text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists merch_orders_status_idx on merch_orders (status, created_at desc);
create index if not exists merch_orders_member_idx on merch_orders (team_member_id, created_at desc);

do $$
declare
  t text;
begin
  foreach t in array array['merch_products', 'merch_orders']
  loop
    execute format(
      'drop trigger if exists set_updated_at on %I; create trigger set_updated_at before update on %I for each row execute function set_updated_at();',
      t, t
    );
    execute format('alter table %I enable row level security;', t);
    execute format(
      'drop policy if exists "authenticated_full_access" on %I; create policy "authenticated_full_access" on %I for all to authenticated using (true) with check (true);',
      t, t
    );
  end loop;
end $$;

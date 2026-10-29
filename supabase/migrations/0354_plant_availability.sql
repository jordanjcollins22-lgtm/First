-- What the plant nurseries have this week, from the availability list each
-- one sends: the plant, the pot size, what it costs us, the sale price when
-- there is one, how it looks (ready, going dormant) and how many they have.
--
-- One row a plant and size at a nursery. Each new week's list replaces the
-- last one's numbers rather than piling up, so the page always reads as this
-- week; the week a row was last seen on says how fresh it is. A plant that
-- drops off the list is kept with nothing available, since it was offered
-- before and may be again.
create table if not exists plant_availability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  supplier_id uuid not null references material_suppliers(id) on delete cascade,
  -- The nursery's own code for the plant and size, so next week's list finds it.
  item_code text not null check (length(trim(item_code)) > 0),
  name text not null check (length(trim(name)) > 0),
  -- As the nursery writes it: 1G, 2G, 3.25", DP50.
  size text not null,
  -- N native, NS native selection; NH not hardy here.
  native text,
  hardy text,
  category text,
  program text,
  -- Each, what we pay.
  cost_cents integer not null check (cost_cents >= 0),
  -- This week's sale price, each, when there is one, and the last day it holds.
  sale_cents integer check (sale_cents is null or sale_cents >= 0),
  sale_until date,
  -- READY, GOING DORMANT, ADVANCE ORDER ONLY, as the nursery writes it.
  condition text,
  available integer not null default 0 check (available >= 0),
  upc text,
  -- The week the list was for.
  week_of date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, supplier_id, item_code)
);

create index if not exists plant_availability_org_idx on plant_availability (organization_id, name);

comment on table plant_availability is
  'Plants each nursery has this week: size, our cost, sale price, condition and how many are available.';

alter table plant_availability enable row level security;

-- Everyone in the business reads it, since plants are priced from it.
-- Changes go through the server, which checks for an owner or admin.
create policy plant_availability_read on plant_availability
  for select to authenticated
  using (organization_id = current_org_id());

notify pgrst, 'reload schema';

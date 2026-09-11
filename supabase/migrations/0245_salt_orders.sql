-- Prepaid ice melt, sold three treatments at a time.
--
-- A salting round is not a landscaping job and pricing it like one gets it
-- wrong in a way that is easy to miss. The product is nearly free: calcium
-- chloride goes down thin and a residential sidewalk takes a pound or two,
-- which is under two dollars. What costs money is the trip. Somebody gets in
-- the truck at five in the morning, drives there, does fifteen minutes of
-- work, and drives to the next one, and that is true whether they spread one
-- pound or five.
--
-- Which is why the minimum is three treatments, prepaid. A single call-out in
-- a storm loses money; three booked before the season turns a street into a
-- route worth driving. Taking the money up front is the whole point of the
-- form: it is the difference between a list of people who said they were
-- interested in October and a round that is already paid for in January.
--
-- One row per order. The customer, property and job it creates are linked
-- from here rather than the other way round, so an order that arrives before
-- anybody has looked at it is still a complete record of what was bought.
create table if not exists salt_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  -- What they typed. Kept as submitted as well as linked, because the client
  -- record gets edited by the office afterwards and the order should still
  -- say what was actually bought and by whom.
  name text not null,
  email text not null,
  address text not null,
  phone text,
  -- Picked from the address suggestions, or looked up on the server from what
  -- they typed. A property row cannot exist without them, so an order that
  -- arrives with neither is still taken and still paid, and waits for
  -- somebody to place it rather than being refused at the card sheet.
  lat double precision,
  lng double precision,

  surface text not null check (surface in ('sidewalks', 'driveway', 'both')),
  pet_friendly boolean not null default false,
  treatments integer not null check (treatments >= 3),
  -- Treatments actually delivered. What is left is what still has to be
  -- bought for, which is the only honest basis for an order list.
  treatments_used integer not null default 0 check (treatments_used >= 0),

  per_treatment_cents integer not null check (per_treatment_cents > 0),
  amount_cents integer not null check (amount_cents > 0),

  status text not null default 'unpaid'
    check (status in ('unpaid', 'paid', 'cancelled')),
  checkout_session_id text,
  paid_at timestamptz,

  -- Filled in once the money lands. Null on an order that never paid, which
  -- is why nothing downstream is created until it does.
  customer_id uuid references customers(id) on delete set null,
  property_id uuid references properties(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,

  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table salt_orders is
  'One prepaid ice melt order. Three treatment minimum, paid before the season, which is what turns a list of interested people into a route.';
comment on column salt_orders.treatments_used is
  'Treatments delivered. Outstanding treatments are what the buying list is worked out from.';

create index if not exists salt_orders_org_idx on salt_orders (organization_id, status, created_at desc);
create index if not exists salt_orders_session_idx on salt_orders (checkout_session_id);

alter table salt_orders enable row level security;

-- The office reads and manages its own. The client writing the row has no
-- account, so that insert goes through the service role like every other
-- public purchase in this app.
drop policy if exists salt_orders_own_org on salt_orders;
create policy salt_orders_own_org on salt_orders
  for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- What the pricing is built from.
--
-- Every one of these is a setting rather than a constant because the two that
-- matter most, what a bag costs and how long a stop takes, are things only the
-- business knows and they move. The defaults are a starting point to check
-- against a real invoice, not a claim about what anything costs.
alter table organizations
  add column if not exists salt_enabled boolean not null default true,
  add column if not exists salt_bag_cost_cents integer not null default 3200,
  add column if not exists salt_pet_bag_cost_cents integer not null default 4500,
  add column if not exists salt_bag_pounds integer not null default 50,
  add column if not exists salt_sidewalk_pounds numeric not null default 2,
  add column if not exists salt_driveway_pounds numeric not null default 5,
  add column if not exists salt_sidewalk_minutes integer not null default 20,
  add column if not exists salt_driveway_minutes integer not null default 15,
  add column if not exists salt_pet_surcharge_cents integer not null default 0;

comment on column organizations.salt_bag_cost_cents is
  'What a bag of calcium chloride costs us. Check it against a supplier invoice: everything downstream is built on it.';
comment on column organizations.salt_pet_surcharge_cents is
  'What the pet safe blend adds to a treatment. Zero on purpose: "no extra charge" sells better than a dollar recovers.';

notify pgrst, 'reload schema';

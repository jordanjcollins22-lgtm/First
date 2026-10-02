-- A mow, bought from a link in about a minute.
--
-- The client types their address, sees their own lot from above with a lawn
-- size worked out from the county's records, gets a price for their size of
-- lawn, and pays for the first mow by card. Nobody has a date yet: a team
-- member calls within 24 hours to set one, which is why the order carries a
-- "called" time and the call list counts the hours since payment.
--
-- Shaped like salt_orders, for the same reason: the row is written unpaid
-- before the card form opens, and the client, property and job it makes are
-- linked from here once the money lands.
create table if not exists mow_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  name text not null,
  email text not null,
  phone text not null,
  address text not null,
  lat double precision,
  lng double precision,

  -- The estimate they were shown, and the tier they paid for. Kept as shown,
  -- since the client may have moved it a size up or down themselves. Saved
  -- with their details before the price is shown, so somebody who leaves at
  -- the price is still a name and a number; until they pick a size (no lot
  -- on the county map, or more than an acre) the tier and price are empty.
  lot_sqft integer,
  lawn_sqft integer,
  estimated_tier text,
  tier text,
  tier_moved boolean not null default false,
  regular_cents integer check (regular_cents > 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  amount_cents integer check (amount_cents > 0),

  -- The tracked link they came from (?rec=), so a booking counts for the post.
  referral_code text,

  -- Unpaid is everybody who saw a price and has not paid; paid has an amount.
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'cancelled')),
  checkout_session_id text,
  paid_at timestamptz,

  customer_id uuid references customers(id) on delete set null,
  property_id uuid references properties(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,

  -- When somebody reached them to set the day. The promise is within 24 hours of paying.
  called_at timestamptz,
  called_by uuid references profiles(id) on delete set null,

  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mow_orders_paid_has_amount check (status <> 'paid' or (tier is not null and amount_cents is not null))
);

comment on table mow_orders is
  'A first mow bought and paid for from the quick mow page. A team member calls within 24 hours to set the day.';

create index if not exists mow_orders_org_idx on mow_orders (organization_id, status, paid_at desc);
create index if not exists mow_orders_session_idx on mow_orders (checkout_session_id);

alter table mow_orders enable row level security;

-- The office reads and manages its own. The client has no account, so their
-- insert goes through the service role like every other public purchase.
drop policy if exists mow_orders_own_org on mow_orders;
create policy mow_orders_own_org on mow_orders
  for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- Where a tracked link goes. Null is the booking page, as every link went
-- before; a path such as '/mow' sends that one link somewhere else, still
-- through the click count and still carrying its code.
alter table outreach_links add column if not exists destination text
  check (destination is null or destination ~ '^/[a-z0-9/_-]*$');

comment on column outreach_links.destination is
  'A path on our own site this link opens instead of the booking page. Null for the booking page.';

-- Which pipeline a job is on. Quick mow requests have their own funnel (seen a
-- price, paid, called, scheduled, mowed) and no evaluation or proposal, so
-- they would only clutter the evaluation-and-proposal pipeline. Everything
-- already in the database is on the main one.
alter table jobs add column if not exists pipeline text not null default 'main'
  check (pipeline in ('main', 'quick_mow'));

comment on column jobs.pipeline is
  'main: evaluation, proposal and project work. quick_mow: a lawn mow requested and paid for on the quick mow page.';

notify pgrst, 'reload schema';

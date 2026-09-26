-- The trucks and trailers, and what replacing them costs.
--
-- Nothing recorded any of this, which meant the single largest risk to the
-- business was carried entirely in one person's head: one truck, one utility
-- trailer, one dump trailer, all old, and no crew gets to a job without them.
-- A landscaping company whose truck dies on a Tuesday does not lose a repair
-- bill, it loses the week.
--
-- Two tables because they answer two questions. What we have and how likely it
-- is to strand us, and what we are replacing it with and when the money is
-- there. The second is the one that gets acted on; the first is what makes the
-- case for acting.
create table if not exists fleet_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  -- What it is called out loud, which is never its model. "The Titan".
  name text not null,
  kind text not null default 'truck'
    check (kind in ('truck', 'trailer', 'mower', 'other')),

  year integer check (year is null or year between 1900 and 2100),
  make text,
  model text,
  -- Trailers have no odometer, so this stays null on most of them and the
  -- risk model has to work without it.
  mileage integer check (mileage is null or mileage >= 0),

  -- Somebody's judgement, not a diagnostic. It is the best signal available
  -- and it is the one that changes fastest.
  condition text not null default 'fair'
    check (condition in ('good', 'fair', 'poor', 'failing')),

  -- What actually happened, which beats any guess about age. A truck that has
  -- stranded a crew twice this year is a different truck from one the same age
  -- that has not.
  breakdowns_12mo integer not null default 0 check (breakdowns_12mo >= 0),
  last_breakdown_on date,

  -- What it costs to keep. Insurance, payment, the repairs nobody planned.
  monthly_cost numeric check (monthly_cost is null or monthly_cost >= 0),
  -- Roughly what it would fetch, for the deposit on the thing replacing it.
  resale_value numeric check (resale_value is null or resale_value >= 0),

  notes text,
  retired_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table fleet_assets is
  'One truck, trailer or machine the crew depends on. Carries condition and breakdown history so the odds of being stranded can be put in numbers rather than carried in somebody head.';

create index if not exists fleet_assets_org_idx
  on fleet_assets (organization_id, retired_on, kind, name);

alter table fleet_assets enable row level security;

drop policy if exists fleet_assets_own_org on fleet_assets;
create policy fleet_assets_own_org on fleet_assets
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- What we are buying, and what standing still costs while we wait.
--
-- A service belongs in here alongside the machines. Outsourcing debris removal
-- is a way of not buying a dump trailer, and if the two are recorded in
-- different places nobody can compare them -- which is the only comparison
-- that matters when the alternative is eight thousand dollars of trailer.
create table if not exists fleet_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  name text not null,
  kind text not null default 'truck'
    check (kind in ('truck', 'trailer', 'mower', 'service', 'other')),

  -- Cash price, in cents, because money in this app is counted in cents
  -- everywhere it is compared with Stripe.
  cost_cents integer check (cost_cents is null or cost_cents >= 0),
  -- What has to be found to drive it away, when it is being financed.
  deposit_cents integer check (deposit_cents is null or deposit_cents >= 0),
  -- What it costs every month afterwards: the payment, the insurance, or the
  -- haulage bill on an outsourced service.
  monthly_cents integer check (monthly_cents is null or monthly_cents >= 0),

  -- Which of ours it retires. Null for something new rather than a
  -- replacement.
  replaces_asset_id uuid references fleet_assets(id) on delete set null,

  -- Lower is sooner. The order things get bought in when the money only
  -- stretches to one of them.
  priority integer not null default 100,

  url text,
  notes text,
  ordered_on date,
  bought_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table fleet_targets is
  'Something the business intends to buy, or a service it intends to pay for instead of buying. Services live here too so "outsource it" can be compared against "buy a trailer" in one place.';

create index if not exists fleet_targets_org_idx
  on fleet_targets (organization_id, bought_on, priority);

alter table fleet_targets enable row level security;

drop policy if exists fleet_targets_own_org on fleet_targets;
create policy fleet_targets_own_org on fleet_targets
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';

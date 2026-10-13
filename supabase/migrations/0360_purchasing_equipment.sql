-- Purchasing, deliveries, reorders and equipment upkeep.
--
-- The app could already say what a job needs (the estimate behind the
-- proposal lists every material and how much), what is on the shelf, and who
-- sells it. Nothing joined those up: an accepted job became a phone call to
-- the yard, a low shelf was a number on a page, and a mower's oil was changed
-- when somebody remembered. This file adds the records that close those loops.
--
-- Everything is additive. New columns are nullable or defaulted, new tables
-- carry their own org-scoped policies, and nothing existing is rewritten.
-- Every automation reads a settings row that does not exist until the owner
-- opens the panel and switches it on, and each switch records when it was
-- first turned on so the automation only acts on what happens after that.

-- ---------------------------------------------------------------------------
-- 1. Who to email, and which product is the usual one
-- ---------------------------------------------------------------------------

-- A purchase order has to go somewhere. The supplier table had a phone and a
-- website but no inbox.
alter table material_suppliers add column if not exists email text;

-- The supplier catalogue was keyed by a kind of material ("mulch"), which is
-- enough to price a quote but not to order: the order has to say which of the
-- business's own materials this product is. `preferred` marks the one to
-- order when two suppliers sell the same thing.
alter table supplier_products add column if not exists material_id uuid references materials(id) on delete set null;
alter table supplier_products add column if not exists preferred boolean not null default false;
create index if not exists supplier_products_material_idx on supplier_products (material_id) where material_id is not null;

-- Bagged and boxed things (seed, fertiliser, fabric) are not bulk products,
-- and supplier_products only takes yards and tons, so the material itself can
-- name where it usually comes from. How much to order when it runs low is the
-- material's business too: a shelf of seed is reordered by the pallet, not by
-- the threshold.
alter table materials add column if not exists preferred_supplier_id uuid references material_suppliers(id) on delete set null;
alter table materials add column if not exists reorder_quantity numeric(10, 2) check (reorder_quantity is null or reorder_quantity > 0);

-- ---------------------------------------------------------------------------
-- 2. Purchasing settings, one row per business
-- ---------------------------------------------------------------------------
create table if not exists public.purchasing_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  -- Accepted or scheduled jobs become draft purchase orders.
  takeoff_enabled boolean not null default false,
  takeoff_started_at timestamptz,
  -- Materials that fall below their reorder threshold become draft orders.
  reorder_enabled boolean not null default false,
  reorder_started_at timestamptz,
  -- Approved orders are emailed to the supplier without anybody pressing send.
  auto_send_enabled boolean not null default false,
  auto_send_started_at timestamptz,
  -- Orders under this are approved on creation. Over it, somebody looks.
  auto_approve_under_cents integer not null default 50000 check (auto_approve_under_cents >= 0),
  -- Tell the job's project lead when orders are drafted or materials are late.
  notify_lead boolean not null default true,
  -- Materials should be in hand this many days before the first work day.
  in_hand_days_before integer not null default 2 check (in_hand_days_before between 0 and 30),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);
alter table public.purchasing_settings enable row level security;
drop policy if exists purchasing_settings_own_org on public.purchasing_settings;
create policy purchasing_settings_own_org on public.purchasing_settings
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- 3. What each job needs, worked out once
-- ---------------------------------------------------------------------------
-- One row per job. `lines` is the arithmetic: needed, taken from stock, to
-- order. Kept so the panel can show the workings, and so stock set aside for
-- one job is not promised to the next one (open takeoffs reserve it).
create table if not exists public.job_material_takeoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  proposal_id uuid references job_proposals(id) on delete set null,
  first_work_day date,
  needed_by date,
  -- [{ materialId, name, unit, needed, fromStock, toOrder, supplierId, note }]
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  -- open: reserving stock and watching deliveries. closed: the work started.
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id)
);
create index if not exists job_material_takeoffs_org_idx on public.job_material_takeoffs (organization_id, status, first_work_day);
alter table public.job_material_takeoffs enable row level security;
drop policy if exists job_material_takeoffs_own_org on public.job_material_takeoffs;
create policy job_material_takeoffs_own_org on public.job_material_takeoffs
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- 4. Purchase orders and their lines
-- ---------------------------------------------------------------------------
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Printed on the email so the yard can quote it back.
  po_number bigint generated always as identity,
  -- Null while nobody has said where it comes from: the panel asks.
  supplier_id uuid references material_suppliers(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'confirmed', 'partial', 'delivered', 'picked_up', 'cancelled')),
  source text not null default 'manual' check (source in ('takeoff', 'reorder', 'manual')),
  job_id uuid references jobs(id) on delete set null,
  takeoff_id uuid references public.job_material_takeoffs(id) on delete set null,
  fulfilment text not null default 'delivery' check (fulfilment in ('delivery', 'pickup')),
  needed_by date,
  first_work_day date,
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  -- Every line has a price. An unpriced order is never auto-approved.
  fully_priced boolean not null default false,
  approved_at timestamptz,
  approved_by uuid references profiles(id) on delete set null,
  auto_approved boolean not null default false,
  -- The send is claimed before it is made, so two runs cannot email twice.
  send_claimed_at timestamptz,
  sent_at timestamptz,
  sent_via text,
  send_error text,
  confirmed_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  notes text,
  -- What made it, so a second run makes nothing: takeoff:<job>:<supplier>,
  -- reorder:<material>:<day>.
  dedupe_key text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists purchase_orders_dedupe_idx on public.purchase_orders (organization_id, dedupe_key) where dedupe_key is not null;
create index if not exists purchase_orders_org_status_idx on public.purchase_orders (organization_id, status, needed_by);
create index if not exists purchase_orders_job_idx on public.purchase_orders (job_id) where job_id is not null;
alter table public.purchase_orders enable row level security;
drop policy if exists purchase_orders_own_org on public.purchase_orders;
create policy purchase_orders_own_org on public.purchase_orders
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  material_id uuid references materials(id) on delete set null,
  supplier_product_id uuid references supplier_products(id) on delete set null,
  name text not null check (length(trim(name)) > 0),
  -- In the material's own unit, which is what the shelf is counted in.
  quantity numeric(10, 2) not null check (quantity > 0),
  unit text not null,
  -- What the supplier is asked for, in their unit (tons of stone, say).
  order_quantity numeric(10, 2),
  order_unit text,
  unit_cost_cents integer check (unit_cost_cents is null or unit_cost_cents >= 0),
  received_quantity numeric(10, 2) not null default 0 check (received_quantity >= 0),
  job_id uuid references jobs(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists purchase_order_lines_po_idx on public.purchase_order_lines (purchase_order_id);
create index if not exists purchase_order_lines_material_idx on public.purchase_order_lines (material_id) where material_id is not null;
alter table public.purchase_order_lines enable row level security;
drop policy if exists purchase_order_lines_own_org on public.purchase_order_lines;
create policy purchase_order_lines_own_org on public.purchase_order_lines
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- 5. A ledger of exceptions raised by the supply automations
-- ---------------------------------------------------------------------------
-- job_exceptions has no idempotency key, and a cron that runs every fifteen
-- minutes must not report the same late delivery ninety times. The claim is
-- written here first; only the run that wins it writes the exception.
create table if not exists public.supply_exception_claims (
  organization_id uuid not null references organizations(id) on delete cascade,
  dedupe_key text not null,
  job_exception_id uuid references public.job_exceptions(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, dedupe_key)
);
alter table public.supply_exception_claims enable row level security;
drop policy if exists supply_exception_claims_own_org on public.supply_exception_claims;
create policy supply_exception_claims_own_org on public.supply_exception_claims
  for select to authenticated
  using (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- 6. Equipment: what it is, what it reads, and when it needs looking after
-- ---------------------------------------------------------------------------
-- fleet_assets.kind only knows truck, trailer, mower and other, and widening a
-- check constraint is not an additive change. The finer type sits beside it:
-- a trimmer is kind 'other', type 'trimmer'.
alter table fleet_assets add column if not exists equipment_type text
  check (equipment_type is null or equipment_type in ('truck', 'trailer', 'mower', 'trimmer', 'blower', 'spreader', 'plow', 'salter', 'other'));
alter table fleet_assets add column if not exists engine_hours numeric(10, 1)
  check (engine_hours is null or engine_hours >= 0);
-- What the crew reads off it at the end of the day: the odometer, the hour
-- meter, or nothing (a blower has no meter; they say how long it ran).
alter table fleet_assets add column if not exists meter text not null default 'none'
  check (meter in ('miles', 'hours', 'none'));

create table if not exists public.equipment_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  -- Overdue service becomes an alert for the project lead.
  maintenance_alerts_enabled boolean not null default false,
  maintenance_started_at timestamptz,
  -- Nobody ticked the load-out by the time the trucks should be gone.
  loadout_watch_enabled boolean not null default false,
  loadout_started_at timestamptz,
  -- Minutes after the shop arrival time before a missing load-out is reported.
  loadout_grace_minutes integer not null default 60 check (loadout_grace_minutes between 0 and 600),
  -- New visits get their kits filled in from the services sold.
  kit_derive_enabled boolean not null default false,
  kit_derive_started_at timestamptz,
  -- How far ahead "due soon" looks.
  due_soon_days integer not null default 14 check (due_soon_days between 0 and 120),
  due_soon_hours integer not null default 10 check (due_soon_hours >= 0),
  due_soon_miles integer not null default 500 check (due_soon_miles >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);
alter table public.equipment_settings enable row level security;
drop policy if exists equipment_settings_own_org on public.equipment_settings;
create policy equipment_settings_own_org on public.equipment_settings
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- A service interval. With asset_id null it applies to every asset of
-- `equipment_type`; with asset_id set it is that machine's own, and replaces
-- a type-wide interval of the same task name.
create table if not exists public.equipment_service_intervals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid references fleet_assets(id) on delete cascade,
  equipment_type text,
  task text not null check (length(trim(task)) > 0),
  every_hours numeric(10, 1) check (every_hours is null or every_hours > 0),
  every_miles integer check (every_miles is null or every_miles > 0),
  every_days integer check (every_days is null or every_days > 0),
  -- Seeded, not chosen. The panel says "default, adjust to your manual".
  is_default boolean not null default false,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (asset_id is not null or equipment_type is not null),
  check (every_hours is not null or every_miles is not null or every_days is not null)
);
create index if not exists equipment_service_intervals_org_idx on public.equipment_service_intervals (organization_id, equipment_type);
create unique index if not exists equipment_service_intervals_type_task_idx
  on public.equipment_service_intervals (organization_id, equipment_type, lower(task)) where asset_id is null;
alter table public.equipment_service_intervals enable row level security;
drop policy if exists equipment_service_intervals_own_org on public.equipment_service_intervals;
create policy equipment_service_intervals_own_org on public.equipment_service_intervals
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- When a task was last done, and what the meter read then.
create table if not exists public.equipment_service_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references fleet_assets(id) on delete cascade,
  task text not null check (length(trim(task)) > 0),
  done_on date not null,
  at_hours numeric(10, 1),
  at_miles integer,
  cost_cents integer check (cost_cents is null or cost_cents >= 0),
  note text,
  recorded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists equipment_service_records_asset_idx on public.equipment_service_records (asset_id, lower(task), done_on desc);
alter table public.equipment_service_records enable row level security;
drop policy if exists equipment_service_records_own_org on public.equipment_service_records;
create policy equipment_service_records_own_org on public.equipment_service_records
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- The end-of-day log. One row per person, machine and day, so correcting a
-- typo replaces the number rather than adding a second one.
create table if not exists public.equipment_usage_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references fleet_assets(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  day date not null,
  -- The meter reading, for machines that have one.
  reading numeric(10, 1) check (reading is null or reading >= 0),
  -- Hours it ran, for machines that don't.
  used_hours numeric(5, 1) check (used_hours is null or (used_hours >= 0 and used_hours <= 24)),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (asset_id, profile_id, day)
);
create index if not exists equipment_usage_logs_org_day_idx on public.equipment_usage_logs (organization_id, day);
alter table public.equipment_usage_logs enable row level security;
drop policy if exists equipment_usage_logs_own_org on public.equipment_usage_logs;
create policy equipment_usage_logs_own_org on public.equipment_usage_logs
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- An overdue service, raised once, closed when the work is logged. Equipment
-- is not a job, and job_exceptions needs one, so these are their own record.
create table if not exists public.equipment_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references fleet_assets(id) on delete cascade,
  task text not null,
  summary text not null,
  state text not null default 'open' check (state in ('open', 'resolved', 'dismissed')),
  -- equipment:<asset>:<task>:<due point>, so one overdue stretch is one alert.
  dedupe_key text not null,
  raised_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references profiles(id) on delete set null,
  resolution text,
  unique (organization_id, dedupe_key)
);
create index if not exists equipment_alerts_open_idx on public.equipment_alerts (organization_id, state);
alter table public.equipment_alerts enable row level security;
drop policy if exists equipment_alerts_own_org on public.equipment_alerts;
create policy equipment_alerts_own_org on public.equipment_alerts
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- 7. Kits from the services sold
-- ---------------------------------------------------------------------------
-- Set when the kits on a visit were filled in from its services, so a person
-- who then clears them is not overruled on the next run.
alter table job_work_sessions add column if not exists kits_derived_at timestamptz;

-- ---------------------------------------------------------------------------
-- 8. Default service intervals, for every business that exists
-- ---------------------------------------------------------------------------
-- Sensible starting points from common manufacturer schedules for commercial
-- landscaping equipment. They are marked is_default so the panel can say so:
-- every owner's manual wins over this table.
insert into public.equipment_service_intervals (organization_id, equipment_type, task, every_hours, every_miles, every_days, is_default, notes)
select o.id, v.equipment_type, v.task, v.every_hours, v.every_miles, v.every_days, true, v.notes
from organizations o
cross join (values
  ('mower',    'Oil and filter change',            100::numeric, null::integer, 365, 'Commercial zero-turn engines: 100 hours or yearly, whichever first.'),
  ('mower',    'Blade sharpening',                  25,           null,          null, 'Every 20-25 cutting hours; sooner in sandy ground.'),
  ('mower',    'Air filter check',                  50,           null,          null, 'Clean every 25-50 hours, replace yearly.'),
  ('mower',    'Grease spindles and pivots',        50,           null,          null, null),
  ('mower',    'Hydraulic fluid and filters',       500,          null,          null, null),
  ('mower',    'Spark plug',                        200,          null,          365,  null),
  ('trimmer',  'Air filter and spark plug',         50,           null,          180,  null),
  ('trimmer',  'Gearbox grease',                    25,           null,          null, null),
  ('blower',   'Air filter and spark plug',         50,           null,          180,  null),
  ('blower',   'Fuel filter',                       null,         null,          365,  null),
  ('spreader', 'Clean, lubricate and check gearbox', null,        null,          30,   'Fertiliser and salt corrode; rinse after every use.'),
  ('spreader', 'Calibration check',                 null,         null,          180,  null),
  ('plow',     'Pre-season inspection',             null,         null,          365,  'Hoses, cutting edge, pins, lights, before the first storm.'),
  ('plow',     'Cutting edge check',                null,         null,          30,   'In season.'),
  ('salter',   'Pre-season inspection',             null,         null,          365,  null),
  ('truck',    'Oil and filter change',             null,         5000,          180,  'Severe-duty schedule for towing and idling.'),
  ('truck',    'Tire rotation',                     null,         7500,          null, null),
  ('truck',    'Brake inspection',                  null,         15000,         365,  null),
  ('truck',    'Maryland registration renewal',     null,         null,          365,  'Set to your actual renewal cycle (1 or 2 years).'),
  ('truck',    'Insurance renewal',                 null,         null,          365,  null),
  ('trailer',  'Bearings and brakes',               null,         null,          365,  'Repack bearings yearly or every 12,000 miles.'),
  ('trailer',  'Lights, tires and safety chains',   null,         null,          90,   null),
  ('trailer',  'Maryland registration renewal',     null,         null,          365,  'Set to your actual renewal cycle.')
) as v(equipment_type, task, every_hours, every_miles, every_days, notes)
on conflict do nothing;

notify pgrst, 'reload schema';

-- Weather rescheduling and snow operations.
--
-- Four things, all additive.
--
-- 1. weather_ops_settings: one row per business. The switches for the
--    weather cascade (move rained-out work days forward, the whole crew's
--    chain with them) and for snow events (suggest one from the forecast,
--    tell clients when their property was serviced, bill per event). Every
--    automation here has its own on/off and records when it was first
--    switched on, so nothing acts on work that predates the switch.
--
-- 2. weather_reschedules: every move the cascade proposed or made, one row
--    per visit moved. The unique key is what keeps a run every three hours
--    from proposing the same move twice, and the log is how the office
--    answers "why is the Smith job on Thursday now".
--
-- 3. salt_orders grows the contract terms. A salt client already is a
--    salt_orders row; a commercial lot billed per push is the same client
--    with different terms, so the terms go on that row rather than on a new
--    table that would have to be kept in step with it. Existing rows are
--    'prepaid' (three or more treatments paid up front), which is what they
--    are today, and nothing about how they behave changes.
--
-- 4. snow_events, snow_event_stops, snow_event_invoices: one storm, the
--    stops the crew made in it (time, photo, GPS, surface temperature, salt
--    put down), and the bill each contract client gets when it closes.

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------

create table if not exists public.weather_ops_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,

  -- The cascade. Off until somebody switches it on; started_at is set the
  -- first time it is, and only visits created or changed after it are moved
  -- unless cover_existing says the owner chose to include the rest.
  cascade_enabled boolean not null default false,
  cascade_started_at timestamptz,
  cover_existing boolean not null default false,
  -- Move without asking when every move is within the limits below. Over
  -- them, the moves wait as a proposal and an exception goes to the lead.
  auto_apply boolean not null default true,
  max_auto_shift_days integer not null default 3 check (max_auto_shift_days between 1 and 14),
  max_auto_moves integer not null default 25 check (max_auto_moves between 1 and 200),
  -- ISO weekdays the crews work, 0 = Sunday. A moved day only lands on one.
  work_weekdays integer[] not null default '{1,2,3,4,5}',

  -- The rain-delay rules. Inches of rain on the day, at or above the
  -- chance, that stops each kind of work; and how much rain leaves the
  -- ground too wet for the days after.
  mow_rain_in numeric not null default 0.25 check (mow_rain_in > 0),
  install_rain_in numeric not null default 0.20 check (install_rain_in > 0),
  rain_chance_min integer not null default 50 check (rain_chance_min between 0 and 100),
  heavy_rain_in numeric not null default 1.0 check (heavy_rain_in > 0),
  saturated_days integer not null default 1 check (saturated_days between 0 and 3),
  snow_blocks_in numeric not null default 0.5 check (snow_blocks_in > 0),

  notify_clients boolean not null default true,
  notify_crew boolean not null default true,

  -- Snow. Suggesting an event from the forecast is its own automation.
  snow_suggest_enabled boolean not null default false,
  snow_suggest_started_at timestamptz,
  -- Depth that suggests a plowing event. SIMA argues against fixed trigger
  -- depths, so any freezing rain or snow on a freezing day suggests a salt
  -- event whatever this says; this only decides when plowing is suggested.
  snow_trigger_in numeric not null default 1.0 check (snow_trigger_in > 0),
  -- "Your property was serviced at 5:12am", per stop.
  snow_client_notice boolean not null default false,
  snow_client_notice_started_at timestamptz,
  -- Bill each contract client when an event closes.
  snow_invoicing_enabled boolean not null default false,
  snow_invoicing_started_at timestamptz,

  last_run_at timestamptz,
  last_run_summary jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);

alter table public.weather_ops_settings enable row level security;
drop policy if exists weather_ops_settings_own_org on public.weather_ops_settings;
create policy weather_ops_settings_own_org on public.weather_ops_settings
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- 2. What the cascade moved
-- ---------------------------------------------------------------------------

create table if not exists public.weather_reschedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  work_session_id uuid not null references job_work_sessions(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  -- The crew's chain this move belongs to. All moves in one chain are
  -- applied together or not at all.
  chain_key text not null,
  run_key text not null,
  from_starts_on date not null,
  from_ends_on date not null,
  to_starts_on date not null,
  to_ends_on date not null,
  work_type text not null,
  -- 'weather' when the forecast broke the rule on this day; 'chain' when it
  -- moved only because the day in front of it did.
  cause text not null check (cause in ('weather', 'chain')),
  reason text not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'applied', 'dismissed', 'failed', 'superseded')),
  exception_id uuid references job_exceptions(id) on delete set null,
  applied_at timestamptz,
  applied_by uuid references profiles(id) on delete set null,
  failure text,
  clients_notified_at timestamptz,
  crew_notified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (work_session_id, from_starts_on, to_starts_on)
);

create index if not exists weather_reschedules_org_idx
  on public.weather_reschedules (organization_id, created_at desc);
create index if not exists weather_reschedules_open_idx
  on public.weather_reschedules (organization_id, status) where status = 'proposed';
create index if not exists weather_reschedules_job_idx on public.weather_reschedules (job_id);
create index if not exists weather_reschedules_exception_idx
  on public.weather_reschedules (exception_id) where exception_id is not null;

alter table public.weather_reschedules enable row level security;
drop policy if exists weather_reschedules_own_org on public.weather_reschedules;
create policy weather_reschedules_own_org on public.weather_reschedules
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- 3. Snow contract terms, on the salt client's own row
-- ---------------------------------------------------------------------------

alter table public.salt_orders
  add column if not exists contract_type text not null default 'prepaid',
  add column if not exists rate_per_push_cents integer,
  add column if not exists rate_per_application_cents integer,
  add column if not exists rate_per_event_cents integer,
  add column if not exists seasonal_price_cents integer,
  add column if not exists trigger_depth_in numeric,
  -- Paved area treated, for the rate table. Null on a residential order,
  -- which uses the salt settings' pounds per surface instead.
  add column if not exists area_sqft integer,
  add column if not exists includes_plowing boolean not null default false,
  -- The office's own order for the route. Null stops are ordered by distance.
  add column if not exists route_order integer;

-- Added only when missing, so running the file twice is harmless.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'salt_orders_contract_type_check') then
    alter table public.salt_orders add constraint salt_orders_contract_type_check
      check (contract_type in ('prepaid', 'per_push', 'per_application', 'per_event', 'seasonal'));
  end if;
end $$;

comment on column public.salt_orders.contract_type is
  'prepaid: treatments paid up front (the salt page). per_push / per_application / per_event: billed when a snow event closes. seasonal: one price for the winter, never billed per event.';

-- ---------------------------------------------------------------------------
-- 4. Snow events
-- ---------------------------------------------------------------------------

create table if not exists public.snow_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  status text not null default 'active'
    check (status in ('suggested', 'active', 'closed', 'dismissed')),
  source text not null default 'manual' check (source in ('manual', 'forecast')),
  -- What the crew is out for: a pre-treat before the storm, salt, or plow.
  service text not null default 'salt' check (service in ('pretreat', 'salt', 'plow')),
  label text not null,
  forecast_date date,
  forecast_snow_in numeric,
  forecast_low_f numeric,
  forecast_note text,
  started_at timestamptz,
  started_by uuid references profiles(id) on delete set null,
  closed_at timestamptz,
  closed_by uuid references profiles(id) on delete set null,
  -- Depth measured on site, for the invoice.
  measured_depth_in numeric,
  invoiced_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live storm at a time, and one suggestion per forecast day.
create unique index if not exists snow_events_one_active
  on public.snow_events (organization_id) where status = 'active';
create unique index if not exists snow_events_one_suggestion_per_day
  on public.snow_events (organization_id, forecast_date) where source = 'forecast';
create index if not exists snow_events_org_idx on public.snow_events (organization_id, created_at desc);

drop trigger if exists set_updated_at on public.snow_events;
create trigger set_updated_at before update on public.snow_events
  for each row execute function set_updated_at();

alter table public.snow_events enable row level security;
drop policy if exists snow_events_own_org on public.snow_events;
create policy snow_events_own_org on public.snow_events
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

create table if not exists public.snow_event_stops (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_id uuid not null references snow_events(id) on delete cascade,
  salt_order_id uuid not null references salt_orders(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  property_id uuid references properties(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  position integer not null,
  name text not null,
  address text not null,
  lat double precision,
  lng double precision,
  status text not null default 'pending' check (status in ('pending', 'done', 'skipped')),
  serviced_at timestamptz,
  logged_by uuid references profiles(id) on delete set null,
  -- Where the phone was when the stop was logged: the proof of service.
  gps_lat double precision,
  gps_lng double precision,
  gps_accuracy_m numeric,
  surface_temp_f numeric,
  depth_in numeric,
  service text check (service in ('pretreat', 'salt', 'plow', 'plow_and_salt')),
  product text check (product in ('rock_salt', 'calcium_chloride', 'pet_safe', 'treated_salt', 'brine', 'none')),
  salt_lbs numeric check (salt_lbs is null or salt_lbs >= 0),
  salt_bags numeric check (salt_bags is null or salt_bags >= 0),
  brine_gallons numeric check (brine_gallons is null or brine_gallons >= 0),
  pushes integer not null default 0 check (pushes >= 0),
  applications integer not null default 0 check (applications >= 0),
  recommended_lbs numeric,
  photo_paths text[] not null default '{}',
  note text,
  skip_reason text,
  -- Opens the client's proof-of-service page at /salt/serviced/<token>.
  proof_token text not null default encode(extensions.gen_random_bytes(18), 'hex'),
  client_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, salt_order_id)
);

create unique index if not exists snow_event_stops_proof_token_key on public.snow_event_stops (proof_token);
create index if not exists snow_event_stops_event_idx on public.snow_event_stops (event_id, position);
create index if not exists snow_event_stops_order_idx on public.snow_event_stops (salt_order_id);

drop trigger if exists set_updated_at on public.snow_event_stops;
create trigger set_updated_at before update on public.snow_event_stops
  for each row execute function set_updated_at();

alter table public.snow_event_stops enable row level security;
drop policy if exists snow_event_stops_own_org on public.snow_event_stops;
create policy snow_event_stops_own_org on public.snow_event_stops
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

create table if not exists public.snow_event_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_id uuid not null references snow_events(id) on delete cascade,
  salt_order_id uuid not null references salt_orders(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  contract_type text not null,
  amount_cents integer not null check (amount_cents >= 0),
  description text not null,
  detail jsonb not null default '{}'::jsonb,
  photo_paths text[] not null default '{}',
  status text not null default 'draft'
    check (status in ('draft', 'open', 'paid', 'void', 'skipped', 'failed')),
  skip_reason text,
  error text,
  stripe_customer_id text,
  stripe_invoice_id text unique,
  hosted_invoice_url text,
  invoice_pdf text,
  sent_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, salt_order_id)
);

create index if not exists snow_event_invoices_org_idx on public.snow_event_invoices (organization_id, created_at desc);

drop trigger if exists set_updated_at on public.snow_event_invoices;
create trigger set_updated_at before update on public.snow_event_invoices
  for each row execute function set_updated_at();

alter table public.snow_event_invoices enable row level security;
drop policy if exists snow_event_invoices_own_org on public.snow_event_invoices;
create policy snow_event_invoices_own_org on public.snow_event_invoices
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

notify pgrst, 'reload schema';

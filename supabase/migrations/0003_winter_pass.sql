-- Winter Pass funnel: core schema.
-- Sessions -> assignments (bandit arms) -> events; orders carry a snapshot of
-- the prices shown, the pinned variants, and the legal hashes accepted.
-- Access model: every table has RLS enabled and NO policies. Only the server
-- (service role, via Next.js route handlers / cron) reads or writes. The anon
-- key is never used for these tables.

create extension if not exists "pgcrypto";

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ============================================================
-- sessions — one row per visitor session (first-party cookie id)
-- ============================================================
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '72 hours', -- variant pin TTL
  device text check (device in ('mobile', 'tablet', 'desktop', 'unknown')) default 'unknown',
  user_agent text,
  referrer text,
  landing_path text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  gclid text,
  ad_group text,                      -- landing-page variant per ad group (step 6)
  zip text,
  ip_hash text                        -- sha256(ip + daily salt); raw IP is not stored here
);
create index if not exists sessions_created_at_idx on sessions(created_at);
create index if not exists sessions_utm_campaign_idx on sessions(utm_campaign);

-- ============================================================
-- experiments / experiment_arms — mirror of experiments.yaml (synced by code)
-- ============================================================
create table if not exists experiments (
  key text primary key,
  description text,
  scope text not null,
  status text not null default 'active' check (status in ('active', 'paused')),
  bounded_by text,                    -- e.g. offer-config.yaml#salt_prebook
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists experiment_arms (
  experiment_key text not null references experiments(key) on delete cascade,
  arm_id text not null,
  payload jsonb not null default '{}',      -- headline text, price, card id, …
  weight numeric(6,5) not null default 0 check (weight >= 0 and weight <= 1),
  active boolean not null default true,     -- never "killed": inactive arms still get the 5% floor
  source text not null default 'yaml' check (source in ('yaml', 'optimizer', 'owner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (experiment_key, arm_id)
);

-- ============================================================
-- assignments — which arm a session was served; pinned until expiry/purchase
-- ============================================================
create table if not exists assignments (
  session_id uuid not null references sessions(id) on delete cascade,
  experiment_key text not null references experiments(key) on delete cascade,
  arm_id text not null,
  assigned_at timestamptz not null default now(),
  pinned_until timestamptz not null default now() + interval '72 hours',
  primary key (session_id, experiment_key),
  foreign key (experiment_key, arm_id) references experiment_arms(experiment_key, arm_id)
);
create index if not exists assignments_experiment_arm_idx on assignments(experiment_key, arm_id, assigned_at);

-- ============================================================
-- events — first-party analytics; the optimizer reads ONLY this table
-- ============================================================
create table if not exists events (
  id bigint generated always as identity primary key,
  session_id uuid references sessions(id) on delete set null,
  name text not null check (name in (
    'page_view', 'scroll_50', 'scroll_90', 'cta_click', 'plan_view', 'plan_select',
    'checkout_start', 'address_valid', 'address_out_of_area', 'legal_accepted',
    'payment_start', 'purchase', 'lead_captured', 'sms_consent', 'checkout_error'
  )),
  ts timestamptz not null default now(),
  path text,
  device text,
  referrer text,
  zip text,
  utm jsonb not null default '{}',          -- snapshot at event time
  variants jsonb not null default '{}',     -- {experiment_key: arm_id} snapshot
  props jsonb not null default '{}',        -- event-specific (plan, add-ons, error code…)
  revenue_cents integer,                    -- purchase only
  plan text,                                -- purchase / plan_* only
  payment_type text check (payment_type in ('pay_in_full', 'monthly')),
  order_id uuid                             -- purchase only (FK added below)
);
create index if not exists events_ts_idx on events(ts);
create index if not exists events_name_ts_idx on events(name, ts);
create index if not exists events_session_idx on events(session_id);

-- ============================================================
-- slot_inventory / slot_reservations — Winter Schedule Hold capacity (real, never faked)
-- ============================================================
create table if not exists slot_inventory (
  season text primary key,                  -- e.g. '2026-27'
  total_slots integer not null check (total_slots >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists slot_reservations (
  id uuid primary key default gen_random_uuid(),
  season text not null references slot_inventory(season),
  order_id uuid not null,
  status text not null default 'held' check (status in ('held', 'confirmed', 'released')),
  held_at timestamptz not null default now(),
  expires_at timestamptz,                   -- null once confirmed
  updated_at timestamptz not null default now()
);
create unique index if not exists slot_reservations_order_idx on slot_reservations(order_id);
create index if not exists slot_reservations_active_idx on slot_reservations(season, status) where status in ('held', 'confirmed');

-- ============================================================
-- orders — one row per checkout attempt; paid rows are customers
-- ============================================================
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete set null,
  season text not null references slot_inventory(season),
  status text not null default 'pending' check (status in (
    'pending', 'paid', 'failed', 'expired', 'refunded', 'cancelled'
  )),
  -- what they bought
  plan text not null check (plan in ('salt_pass', 'salt_plus_pet', 'full_winter_pass')),
  pet_safe boolean not null default false,
  schedule_hold boolean not null default false,
  payment_type text not null check (payment_type in ('pay_in_full', 'monthly')),
  -- the exact prices shown (customer always pays the price they were shown)
  salt_price_cents integer not null,
  pet_safe_price_cents integer not null default 0,
  schedule_hold_price_cents integer not null default 0,
  pay_in_full_discount_pct integer not null default 0,
  subtotal_cents integer not null,
  discount_cents integer not null default 0,
  total_cents integer not null,
  monthly_amount_cents integer,             -- monthly plans only
  monthly_installments integer,
  -- customer + property
  customer_name text not null,
  email text not null,
  phone text not null,
  address_line1 text not null,
  city text not null,
  state text not null default 'MD',
  zip text not null,
  lat double precision,
  lng double precision,
  property_size text check (property_size in ('small', 'standard', 'large', 'estate')),
  property_size_source text default 'manual',
  has_pets boolean,
  -- attribution snapshot
  variants jsonb not null default '{}',     -- pinned {experiment_key: arm_id}
  utm jsonb not null default '{}',
  gclid text,
  device text,
  -- legal: the exact versions accepted, when, from where
  legal_hashes jsonb,                       -- {"service-agreement.md": "<sha256>", …}
  legal_accepted_at timestamptz,
  legal_accepted_ip inet,
  -- payments
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  stripe_subscription_id text,
  stripe_customer_id text,
  paid_at timestamptz,
  -- CRM
  ghl_contact_id text,
  ghl_opportunity_id text,
  ghl_synced_at timestamptz,
  ghl_sync_error text,
  -- referrals
  referral_code text unique,
  referred_by_code text,
  referral_credit_cents integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_status_idx on orders(status, created_at);
create index if not exists orders_email_idx on orders(lower(email));
create index if not exists orders_zip_idx on orders(zip);
create index if not exists orders_session_idx on orders(session_id);

alter table events
  drop constraint if exists events_order_id_fkey,
  add constraint events_order_id_fkey foreign key (order_id) references orders(id) on delete set null;
alter table slot_reservations
  drop constraint if exists slot_reservations_order_id_fkey,
  add constraint slot_reservations_order_id_fkey foreign key (order_id) references orders(id) on delete cascade;

-- ============================================================
-- legal_acceptances — one row per document per acceptance (audit trail)
-- ============================================================
create table if not exists legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete set null,
  lead_id uuid,                             -- FK added after leads
  session_id uuid references sessions(id) on delete set null,
  purpose text not null check (purpose in ('checkout', 'sms_lead')),
  document text not null,                   -- filename in legal/, e.g. 'refund-policy.md'
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  accepted_at timestamptz not null default now(),
  ip inet,
  user_agent text
);
create index if not exists legal_acceptances_order_idx on legal_acceptances(order_id);
create index if not exists legal_acceptances_hash_idx on legal_acceptances(content_hash);

-- ============================================================
-- leads — exit-intent / scroll / waitlist captures
-- ============================================================
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete set null,
  source text not null check (source in (
    'exit_intent', 'scroll_depth', 'waitlist_out_of_area', 'waitlist_sold_out', 'price_sheet'
  )),
  name text,
  email text,
  phone text,
  zip text,
  sms_consent boolean not null default false,
  sms_consent_hash text,                    -- hash of legal/sms-consent.md at consent time
  consented_at timestamptz,
  ip inet,
  variants jsonb not null default '{}',
  utm jsonb not null default '{}',
  ghl_contact_id text,
  ghl_synced_at timestamptz,
  created_at timestamptz not null default now(),
  check (email is not null or phone is not null)
);
create index if not exists leads_created_idx on leads(created_at);
alter table legal_acceptances
  drop constraint if exists legal_acceptances_lead_id_fkey,
  add constraint legal_acceptances_lead_id_fkey foreign key (lead_id) references leads(id) on delete set null;

-- ============================================================
-- optimizer_state — singleton: status, kill switch, last known best
-- ============================================================
create table if not exists optimizer_state (
  id boolean primary key default true check (id),   -- exactly one row
  status text not null default 'running' check (status in ('running', 'paused', 'killed')),
  status_reason text,
  status_changed_at timestamptz not null default now(),
  last_known_best jsonb not null default '{}',      -- {experiment_key: {arm_id: weight}} + prices
  last_known_best_at timestamptz,
  last_run_at timestamptz,
  last_report_date date,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- offer_changes — every change the optimizer or owner applies (revertible)
-- ============================================================
create table if not exists offer_changes (
  id uuid primary key default gen_random_uuid(),
  applied_at timestamptz not null default now(),
  applied_by text not null check (applied_by in ('optimizer', 'owner', 'guardrail')),
  kind text not null check (kind in (
    'reweight', 'add_arm', 'pause_arm', 'price_arm', 'highlight_card', 'copy_arm', 'revert', 'kill', 'resume'
  )),
  experiment_key text references experiments(key) on delete set null,
  before jsonb not null default '{}',
  after jsonb not null default '{}',
  reason text,
  report_date date,
  reverted_at timestamptz,
  reverted_by text,
  reverted_change_id uuid references offer_changes(id)
);
create index if not exists offer_changes_applied_idx on offer_changes(applied_at desc);

-- ============================================================
-- proposals — weekly proposals; auto-applied or awaiting "approve"
-- ============================================================
create table if not exists proposals (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  title text not null,
  rationale text not null,
  experiment_key text references experiments(key) on delete set null,
  payload jsonb not null,                   -- the exact change (validated against allowed fields)
  auto_appliable boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'applied', 'approved', 'rejected', 'reverted')),
  decided_at timestamptz,
  decided_by text,
  offer_change_id uuid references offer_changes(id),
  created_at timestamptz not null default now()
);
create index if not exists proposals_status_idx on proposals(status, report_date desc);

-- ============================================================
-- weekly_reports — plain-English report + metrics (also written to reports/)
-- ============================================================
create table if not exists weekly_reports (
  report_date date primary key,
  markdown text not null,
  summary_sms text not null,                -- what gets texted to the owner
  metrics jsonb not null default '{}',
  guardrail_actions jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- ============================================================
-- webhook_events — idempotency for Stripe / GoHighLevel deliveries
-- ============================================================
create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe', 'gohighlevel')),
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (provider, event_id)
);

-- ============================================================
-- updated_at triggers
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'experiments', 'experiment_arms', 'slot_inventory', 'slot_reservations', 'orders', 'optimizer_state'
  ] loop
    execute format(
      'drop trigger if exists set_updated_at on %I; create trigger set_updated_at before update on %I for each row execute function set_updated_at();',
      t, t
    );
  end loop;
end $$;

-- ============================================================
-- Slot functions — all capacity math happens here, atomically
-- ============================================================
create or replace function remaining_slots(p_season text)
returns integer language sql stable as $$
  select greatest(0,
    (select total_slots from slot_inventory where season = p_season)
    - (select count(*)::int from slot_reservations
        where season = p_season
          and (status = 'confirmed' or (status = 'held' and expires_at > now())))
  );
$$;

-- Hold a slot for an order for p_ttl (default 30 min). Raises 'sold_out' when none remain.
create or replace function reserve_slot(p_order_id uuid, p_season text, p_ttl interval default interval '30 minutes')
returns slot_reservations language plpgsql as $$
declare r slot_reservations;
begin
  perform 1 from slot_inventory where season = p_season for update;
  if not found then raise exception 'unknown_season' using errcode = 'P0002'; end if;
  if remaining_slots(p_season) <= 0 then
    raise exception 'sold_out' using errcode = 'P0001';
  end if;
  insert into slot_reservations (season, order_id, status, expires_at)
  values (p_season, p_order_id, 'held', now() + p_ttl)
  on conflict (order_id) do update
    set status = 'held', expires_at = now() + p_ttl, season = excluded.season
  returning * into r;
  return r;
end $$;

create or replace function confirm_slot(p_order_id uuid)
returns void language sql as $$
  update slot_reservations set status = 'confirmed', expires_at = null where order_id = p_order_id;
$$;

create or replace function release_slot(p_order_id uuid)
returns void language sql as $$
  update slot_reservations set status = 'released' where order_id = p_order_id;
$$;

-- Cron: release stale holds (checkout abandoned).
create or replace function expire_slot_holds()
returns integer language plpgsql as $$
declare n integer;
begin
  update slot_reservations set status = 'released'
  where status = 'held' and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ============================================================
-- Analytics views used by the bandit and the admin dashboard
-- ============================================================
create or replace view arm_stats as
select
  a.experiment_key,
  a.arm_id,
  count(distinct a.session_id)                                   as sessions,
  count(distinct o.id) filter (where o.status = 'paid')          as purchases,
  coalesce(sum(o.total_cents) filter (where o.status = 'paid'), 0)::bigint as revenue_cents,
  case when count(distinct a.session_id) = 0 then 0
       else coalesce(sum(o.total_cents) filter (where o.status = 'paid'), 0)::numeric
            / count(distinct a.session_id) end                  as revenue_per_session_cents,
  min(a.assigned_at)                                             as first_assigned_at,
  max(a.assigned_at)                                             as last_assigned_at
from assignments a
left join orders o on o.session_id = a.session_id
group by a.experiment_key, a.arm_id;

create or replace view daily_funnel as
select
  (ts at time zone 'America/New_York')::date                      as day,
  count(*) filter (where name = 'page_view')                      as page_views,
  count(distinct session_id) filter (where name = 'page_view')    as sessions,
  count(*) filter (where name = 'cta_click')                      as cta_clicks,
  count(*) filter (where name = 'checkout_start')                 as checkout_starts,
  count(*) filter (where name = 'address_out_of_area')            as out_of_area,
  count(*) filter (where name = 'payment_start')                  as payment_starts,
  count(*) filter (where name = 'checkout_error')                 as checkout_errors,
  count(*) filter (where name = 'purchase')                       as purchases,
  coalesce(sum(revenue_cents) filter (where name = 'purchase'), 0) as revenue_cents,
  count(*) filter (where name = 'lead_captured')                  as leads
from events
group by 1;

-- ============================================================
-- Row Level Security: enabled everywhere, no policies. Service role only.
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'sessions', 'experiments', 'experiment_arms', 'assignments', 'events',
    'slot_inventory', 'slot_reservations', 'orders', 'legal_acceptances', 'leads',
    'optimizer_state', 'offer_changes', 'proposals', 'weekly_reports', 'webhook_events'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('revoke all on %I from anon, authenticated;', t);
  end loop;
end $$;
revoke all on arm_stats, daily_funnel from anon, authenticated;

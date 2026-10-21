-- ============================================================
-- Apex Shine Mobile booking funnel (/detailing/start).
--
-- detailing_leads: one row per person who fills in step 1 (contact details
--                  and where the car will be). Step 2 fills in the vehicle
--                  size, add-ons and price they saw when they asked to join
--                  the Complete Care membership.
-- ============================================================

create table if not exists detailing_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- E.164 (e.g. +15551234567). Normalized in app code before insert.
  phone text not null,
  email text not null,
  service_address text not null,
  status text not null default 'lead'
    check (status in ('lead', 'membership_requested')),
  vehicle_size text check (vehicle_size in ('sedan', 'suv', 'truck')),
  -- Prices in whole dollars, as shown on the page when they submitted.
  monthly_price integer,
  add_ons text[] not null default '{}',
  add_ons_total integer,
  ghl_contact_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists detailing_leads_created_idx on detailing_leads (created_at desc);

-- Written only by server actions using the service-role key; no public access.
alter table detailing_leads enable row level security;

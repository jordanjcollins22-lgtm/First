-- The forward pricing settings: the crew's makeup and pay, and every
-- service's production rate.
--
--   CR  = (leads × lead pay) + (technicians × technician pay)
--   PLH = Q ÷ PR, per service
--   R   = (M + PLH × CR) ÷ PCM
--
-- One row per business, set on Admin, Production rates. Until a business
-- saves one, the app prices with its starting figures. The services are kept
-- as a list, in the order they are shown, each with its key, name, unit,
-- production rate (units per crew-hour; none for a per-job cost such as
-- disposal), material cost per unit and whether it is on. A service is
-- turned off rather than deleted, so a proposal saved with it can always be
-- priced again.
create table if not exists production_pricing (
  organization_id uuid primary key references organizations(id) on delete cascade,
  leads integer not null default 1 check (leads between 0 and 20),
  lead_rate_cents integer not null default 4500 check (lead_rate_cents between 0 and 50000),
  technicians integer not null default 1 check (technicians between 0 and 20),
  technician_rate_cents integer not null default 3000 check (technician_rate_cents between 0 and 50000),
  services jsonb not null default '[]'::jsonb check (jsonb_typeof(services) = 'array'),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null,
  constraint production_pricing_has_crew check (leads + technicians > 0)
);

comment on table production_pricing is
  'Forward pricing settings: crew makeup and hourly pay, and each service''s production rate and material cost.';

alter table production_pricing enable row level security;

-- Everyone in the business reads it, since every price is worked out from
-- it. Saving goes through the server, which checks for an owner or admin.
drop policy if exists production_pricing_read on production_pricing;
create policy production_pricing_read on production_pricing
  for select to authenticated
  using (organization_id = current_org_id());

notify pgrst, 'reload schema';

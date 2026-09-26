-- The morning at the shop, run from one screen and followed on every phone.
--
-- The project lead picks up the shop tablet, taps that they are at the shop,
-- and the day starts: one kit at a time to load, then the site maps for the
-- stops they choose to go over, then a button that sends everybody to the
-- first job with directions. The ticks are shared: whoever grabs a tool
-- ticks it and it ticks on every phone. One row per business per day holds
-- where the lead has got to; the ticks are their own rows so two people can
-- tick at once without treading on each other.

create table if not exists crew_shop_days (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  day date not null,
  lead_profile_id uuid not null references profiles(id) on delete cascade,
  stage text not null default 'loadout' check (stage in ('loadout', 'maps', 'en_route')),
  -- Which page of the load-out is up: kit by kit, then the loose tools.
  page_index integer not null default 0,
  -- The stops the lead has chosen to go over on the maps.
  shown_job_ids uuid[] not null default '{}',
  clocked_in_at timestamptz not null default now(),
  loadout_done_at timestamptz,
  en_route_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (organization_id, day)
);

create table if not exists crew_shop_checks (
  id uuid primary key default gen_random_uuid(),
  shop_day_id uuid not null references crew_shop_days(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  item_kind text not null check (item_kind in ('kit', 'tool', 'material')),
  item_key text not null,
  checked_by uuid references profiles(id) on delete set null,
  checked_at timestamptz not null default now(),
  unique (shop_day_id, item_kind, item_key)
);

alter table crew_shop_days enable row level security;
drop policy if exists "crew_shop_days_org" on crew_shop_days;
create policy "crew_shop_days_org" on crew_shop_days for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

alter table crew_shop_checks enable row level security;
drop policy if exists "crew_shop_checks_org" on crew_shop_checks;
create policy "crew_shop_checks_org" on crew_shop_checks for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- Every phone follows the tablet as it happens.
alter table crew_shop_days replica identity full;
alter table crew_shop_checks replica identity full;
alter publication supabase_realtime add table crew_shop_days;
alter publication supabase_realtime add table crew_shop_checks;

-- Selling a flyer spot to somebody outside the business.
--
-- flyer_ad_spots already holds what is on the current flyer, filled in by
-- hand by whoever took the call. This is the other half: a run somebody can
-- buy into from a link, without a phone call and without anybody here typing
-- their details in afterwards.
--
-- Two tables because a run and a booking are different lifetimes. A run is
-- printed once and then it is history; a booking belongs to one run and to
-- one advertiser, and both of those want to be looked up later.

create table if not exists flyer_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  name text not null,
  -- The day it goes to the post office. Null while it is still being filled.
  mails_on date,

  -- Stored rather than read from the code, because a run printed last spring
  -- at a different price is a fact about last spring. A constant would
  -- quietly rewrite history the first time the price changes.
  flyer_count int not null default 2500 check (flyer_count > 0),
  spot_price_cents bigint not null default 30000 check (spot_price_cents >= 0),

  -- open    — taking bookings, this is the one the public link sells
  -- closed  — full or cut off, artwork is with the printer
  -- printed — done
  status text not null default 'open' check (status in ('open', 'closed', 'printed')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists flyer_runs_org_idx on flyer_runs(organization_id, status);

alter table flyer_runs enable row level security;
drop policy if exists "org_scoped_flyer_runs" on flyer_runs;
create policy "org_scoped_flyer_runs" on flyer_runs for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- ---------------------------------------------------------------------------
-- One advertiser, one spot, one run
-- ---------------------------------------------------------------------------
create table if not exists flyer_bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  run_id uuid not null references flyer_runs(id) on delete cascade,

  business_name text not null,
  contact_name text,
  email text,
  phone text,

  -- Their artwork in the flyer-ads bucket. Null until they upload.
  image_path text,

  -- draft    — filling the form in, nothing owed
  -- approved — they have seen the preview and said yes, payment not taken
  -- paid     — money in, the spot is theirs
  -- placed   — assigned a slot on the printed sheet
  -- refunded
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'paid', 'placed', 'refunded')),

  -- Which tile on the sheet, once it is theirs. Null until paid: holding a
  -- slot for somebody who has not paid is how a run sells six spots and
  -- prints four.
  slot int check (slot is null or slot between 1 and 8),

  amount_cents bigint check (amount_cents is null or amount_cents >= 0),
  checkout_session_id text,
  paid_at timestamptz,

  -- Their own link back to this booking, so they can return to a half
  -- finished one without an account.
  token text not null unique,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists flyer_bookings_run_idx on flyer_bookings(run_id, status);
create index if not exists flyer_bookings_org_idx on flyer_bookings(organization_id, created_at desc);

-- One advert per tile per run. Two adverts in one square is not a flyer, it
-- is a mistake somebody finds after 2,500 are printed.
create unique index if not exists flyer_bookings_slot_idx
  on flyer_bookings(run_id, slot) where slot is not null;

alter table flyer_bookings enable row level security;
drop policy if exists "org_scoped_flyer_bookings" on flyer_bookings;
create policy "org_scoped_flyer_bookings" on flyer_bookings for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

comment on table flyer_bookings is
  'An outside business buying a tile on one flyer run, from the public link.';

-- Advertisers upload their own artwork with no account, so the bucket has to
-- take an anonymous write. It is already public to read.
drop policy if exists "public_write_flyer_ads" on storage.objects;
create policy "public_write_flyer_ads"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'flyer-ads');

drop policy if exists "public_read_flyer_ads" on storage.objects;
create policy "public_read_flyer_ads"
  on storage.objects for select
  to anon
  using (bucket_id = 'flyer-ads');

notify pgrst, 'reload schema';

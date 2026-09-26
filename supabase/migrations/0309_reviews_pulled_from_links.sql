-- Reviews pulled from the business's own pages.
--
-- The owner pastes the Facebook page and the Google listing; the Chrome
-- extension, signed in as them, opens each page's reviews and sends what it
-- reads; the app keeps the five-star ones with something written, and never
-- the same review twice. Asked for by a button, and again every week so new
-- ones arrive on their own.
create table if not exists booking_review_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  platform text not null check (platform in ('facebook', 'google')),
  url text not null,
  pull_requested_at timestamptz,
  pulled_at timestamptz,
  -- What the last pull said, in words, for the owner.
  last_result text,
  last_found integer,
  last_kept integer,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, platform)
);

alter table booking_review_sources enable row level security;
drop policy if exists "booking_review_sources_org" on booking_review_sources;
create policy "booking_review_sources_org" on booking_review_sources for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- A pulled review remembers where it came from, so the next pull does not
-- add it again, and one deleted by hand does not come back.
alter table booking_proof
  add column if not exists external_key text,
  add column if not exists source_id uuid references booking_review_sources(id) on delete set null;
create unique index if not exists booking_proof_external_key on booking_proof (organization_id, external_key) where external_key is not null;

-- Keys of pulled reviews the owner deleted, so they stay deleted.
create table if not exists booking_proof_dismissed (
  organization_id uuid not null references organizations(id) on delete cascade,
  external_key text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, external_key)
);
alter table booking_proof_dismissed enable row level security;
drop policy if exists "booking_proof_dismissed_org" on booking_proof_dismissed;
create policy "booking_proof_dismissed_org" on booking_proof_dismissed for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

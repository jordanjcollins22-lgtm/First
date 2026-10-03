-- The address A/B test on the booking page.
--
-- Half of visitors get a "Use my location" button beside the address box;
-- half type. Every page open is a visit with the variant it was shown, and
-- a booking points back at its visit, so the question "do more people book
-- when they can tap?" is answered from bookings over visits and not from
-- bookings alone.

create table if not exists booking_visits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  variant text not null check (variant in ('tap', 'type')),
  referral_code text,
  link_ref text,
  agent text not null default 'unknown',
  -- Only meaningful on the tap variant.
  located_tapped boolean not null default false,
  located_result text check (located_result in ('accepted', 'declined', 'failed')),
  booked_job_id uuid references jobs(id) on delete set null,
  booked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists booking_visits_org_idx on booking_visits (organization_id, created_at desc);

alter table booking_visits enable row level security;
drop policy if exists "booking_visits_org_read" on booking_visits;
create policy "booking_visits_org_read" on booking_visits for select to authenticated
  using (organization_id = (select current_org_id()));

alter table jobs add column if not exists booking_variant text check (booking_variant in ('tap', 'type'));
alter table jobs add column if not exists address_entry text check (address_entry in ('typed', 'located'));

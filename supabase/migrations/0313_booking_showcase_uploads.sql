-- Before and afters the owner adds to the booking page by hand.
--
-- Most come from Before & After Posts, approved from the crew's job photos.
-- This holds the ones already made the same way outside the app, uploaded
-- on the Booking Page: one finished picture each, with the before and the
-- after on it.
create table if not exists booking_showcase (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  image_url text not null,
  position integer not null default 0,
  shown boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists booking_showcase_org_idx on booking_showcase (organization_id, position);

alter table booking_showcase enable row level security;
drop policy if exists "booking_showcase_org" on booking_showcase;
create policy "booking_showcase_org" on booking_showcase for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

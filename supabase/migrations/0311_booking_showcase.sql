-- Before and afters for the booking page's landing card.
--
-- The card cycles through the business's work under "See open times": every
-- before-and-after approved in the social studio, and pairs the owner adds
-- here, such as the ones already on the business's website. Each can be
-- hidden without deleting it.
create table if not exists booking_showcase (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  before_url text,
  after_url text,
  -- A single picture that already shows both, side by side.
  image_url text,
  source text not null default 'owner' check (source in ('owner', 'website')),
  position integer not null default 0,
  shown boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (image_url is not null or (before_url is not null and after_url is not null))
);
create index if not exists booking_showcase_org_idx on booking_showcase (organization_id, position);

alter table booking_showcase enable row level security;
drop policy if exists "booking_showcase_org" on booking_showcase;
create policy "booking_showcase_org" on booking_showcase for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- An approved social post can be kept off the booking page without
-- un-approving it for social media.
alter table social_posts add column if not exists on_booking_page boolean not null default true;

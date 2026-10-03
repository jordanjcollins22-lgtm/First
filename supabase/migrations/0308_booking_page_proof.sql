-- What the booking page shows to back up the comments.
--
-- Every comment says the business has been featured in the news and has
-- amazing reviews, and sends the person to the booking page. The page has
-- to show both, or the first thing somebody sees after clicking is the
-- claim with nothing behind it. The owner enters them: real reviews, word
-- for word, and the real news story. Nothing is shown that was not entered.
create table if not exists booking_proof (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('review', 'news')),
  -- A review: who wrote it, what they said, the stars, and where.
  author text,
  body text,
  stars smallint check (stars between 1 and 5),
  source text,
  written_on date,
  -- A news story: which outlet, the headline, and the link to it.
  outlet text,
  headline text,
  url text,
  position integer not null default 0,
  shown boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists booking_proof_org_idx on booking_proof (organization_id, kind, position);

alter table booking_proof enable row level security;
drop policy if exists "booking_proof_org" on booking_proof;
create policy "booking_proof_org" on booking_proof for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- The owner's preview of the booking page, and where the proof is entered.
insert into role_permissions (role_name, tab_key, granted)
select r, 'booking-page', true
from unnest(array['owner', 'admin']) as r
on conflict do nothing;

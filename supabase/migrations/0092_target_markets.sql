-- Where we actually work.
--
-- "Our market is Harford County" is a sentence everybody in the business
-- knows and nothing in the app did. So a bought list, a parcel import or a CRM
-- export lands with Baltimore, Cecil and half of Pennsylvania mixed in, and
-- the only way to tell is for somebody to recognise the town.
--
-- A table rather than a constant, because the answer changes. A business that
-- takes on a second crew takes on a second county, and the version where that
-- means a code change is the version where it never gets recorded.

create table if not exists target_markets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  name text not null,

  -- Matched in this order: a zip is exact, a town is nearly exact, a county
  -- name only appears in some addresses. Any one matching is a match.
  zips text[] not null default '{}',
  cities text[] not null default '{}',
  counties text[] not null default '{}',

  active boolean not null default true,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, name)
);

create index if not exists target_markets_org_idx on target_markets(organization_id, active);

drop trigger if exists set_updated_at on target_markets;
create trigger set_updated_at before update on target_markets
  for each row execute function set_updated_at();

alter table target_markets enable row level security;

drop policy if exists "org_scoped_target_markets" on target_markets;
create policy "org_scoped_target_markets" on target_markets for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- Everybody starts with the county they actually work in. Editable afterwards
-- — this is a starting point, not a decision made on their behalf.
insert into target_markets (organization_id, name, zips, cities, counties, notes)
select
  o.id,
  'Harford County, MD',
  array[
    '21001','21005','21009','21010','21013','21014','21015','21017','21018',
    '21028','21034','21040','21047','21050','21078','21082','21084','21085',
    '21130','21132','21154','21160','21161'
  ],
  array[
    'Aberdeen','Abingdon','Bel Air','Belcamp','Benson','Churchville','Darlington',
    'Edgewood','Fallston','Forest Hill','Havre de Grace','Jarrettsville','Joppa',
    'Perryman','Pylesville','Street','White Hall','Whiteford'
  ],
  array['Harford'],
  'Seeded with Harford County''s zips and towns. Edit or add markets as the business grows.'
from organizations o
on conflict (organization_id, name) do nothing;

-- Contacts get the same flag prospects already have, so an imported CRM export
-- can be sorted the same way a bought list is.
alter table customers add column if not exists in_target_market boolean;

comment on column customers.in_target_market is
  'Null until checked. False is not a reason to delete them — somebody outside our market still knows the neighbour inside it.';

notify pgrst, 'reload schema';

-- One USPS route at a time, from the evaluations we have done.
--
-- A route holding an evaluated house is put to the owner one question at a
-- time: approve the route for mail, draw the door hanger round over it,
-- confirm the hangers, submit. This row is where that route has got to and
-- what came of it, so the next question is always the right one and a
-- route dealt with never comes round again.
create table if not exists route_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  eddm_route_id uuid not null references eddm_routes(id) on delete cascade,
  -- usps | draw | hangers | submit | ordered | skipped
  status text not null default 'usps' check (status in ('usps', 'draw', 'hangers', 'submit', 'ordered', 'skipped')),
  -- The evaluated houses this route was put forward for.
  house_ids uuid[] not null default '{}',
  mailing_id uuid references eddm_mailings(id) on delete set null,
  play_id uuid references marketing_plays(id) on delete set null,
  usps_approved_at timestamptz,
  usps_approved_by uuid references profiles(id) on delete set null,
  walk_on date,
  mail_on date,
  submitted_at timestamptz,
  submitted_by uuid references profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, eddm_route_id)
);

alter table route_orders enable row level security;
drop policy if exists route_orders_own_org on route_orders;
create policy route_orders_own_org on route_orders
  for all using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

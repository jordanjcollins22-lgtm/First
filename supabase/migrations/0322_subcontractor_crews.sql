-- Subcontractor crews, and what the crew needs at the shop.
--
-- A signed job's visit goes to our own crew or to a subcontractor. A
-- subcontractor has no login: they get a link to their own crew sheet,
-- which says where to go, what to do in each area, and takes their during
-- and after photos and their "we're finished". Some use our tools and pick
-- them up at the shop like our crew; the rest bring their own.

create table if not exists subcontractors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  contact_name text,
  phone text,
  email text,
  -- Picks up kits from our shop, like our crew, rather than bringing their own.
  uses_our_tools boolean not null default false,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

alter table subcontractors enable row level security;
drop policy if exists subcontractors_own_org on subcontractors;
create policy subcontractors_own_org on subcontractors
  for all using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- The visit goes to a subcontractor instead of our crew, with the link that
-- opens their crew sheet and the times they tapped through it.
alter table job_work_sessions add column if not exists subcontractor_id uuid references subcontractors(id) on delete set null;
alter table job_work_sessions add column if not exists crew_token text;
alter table job_work_sessions add column if not exists sub_picked_up_at timestamptz;
alter table job_work_sessions add column if not exists sub_on_way_at timestamptz;
alter table job_work_sessions add column if not exists sub_arrived_at timestamptz;
alter table job_work_sessions add column if not exists sub_finished_at timestamptz;
create unique index if not exists job_work_sessions_crew_token on job_work_sessions (crew_token) where crew_token is not null;

-- What gets the crew into the shop and the kits: the door or gate code at
-- the shop, and the code on each kit's box or lock.
alter table business_locations add column if not exists access_codes text;
alter table kit_containers add column if not exists code text;

-- When the crew is due at the shop in the morning.
alter table organizations add column if not exists shop_arrival_time time not null default '07:00';

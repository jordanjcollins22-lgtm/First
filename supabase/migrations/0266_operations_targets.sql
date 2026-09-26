-- Courts as operations targets.
--
-- A court is a dead-end street: a tight ring of homes with one way in, where
-- one truck parks once and every house can see the work. Operations wants to
-- own courts, not scatter jobs across the county. This keeps one row per
-- court, built from the county's addresses and everything we know about
-- them, and a table of the outlines the office draws round the groups of
-- homes it means to go after.

-- 1. One row per court, rebuilt on demand from the houses.
create table if not exists court_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  street text not null,
  zip text not null,
  locality text,
  house_count integer not null,
  lat double precision not null,
  lng double precision not null,
  -- The ring round the court's homes, as [lng, lat] pairs, closed.
  outline jsonb not null,
  -- How far the farthest home is from the middle, in metres: a tight court
  -- is one parking spot.
  spread_m real,
  assessed_median integer,
  owner_occupied integer not null default 0,
  ownership_known integer not null default 0,
  detached integer not null default 0,
  townhouse integer not null default 0,
  condo integer not null default 0,
  clients integer not null default 0,
  touched integer not null default 0,
  jobs_done integer not null default 0,
  shop_km real,
  built_at timestamptz not null default now(),
  unique (organization_id, street, zip)
);

create index if not exists court_targets_org_idx on court_targets(organization_id);

alter table court_targets enable row level security;

drop policy if exists "court_targets_org_read" on court_targets;
create policy "court_targets_org_read" on court_targets for select to authenticated
  using (organization_id = current_org_id());

-- 2. The outlines the office draws: a court it has chosen, or any group of
--    homes it means to work as one.
create table if not exists operations_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  -- The drawn ring, as {lat, lng} points in order.
  outline jsonb not null,
  court_id uuid references court_targets(id) on delete set null,
  status text not null default 'planned' check (status in ('planned', 'active', 'done')),
  notes text,
  house_count integer,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists operations_targets_org_idx on operations_targets(organization_id);

alter table operations_targets enable row level security;

drop policy if exists "operations_targets_org_all" on operations_targets;
create policy "operations_targets_org_all" on operations_targets for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- 3. Rebuild the courts for one organization from its houses.
--
-- The street is read off the normalized address: everything between the
-- house number and the first CT or COURT. Apartment and condo units on the
-- same court fold into one row. Each court gets its homes, its ring, what
-- the county assesses them at, who lives in them, and how many are already
-- ours.
create or replace function public.court_targets_build(org uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  delete from court_targets where organization_id = org;

  with parsed as (
    select h.id, h.property_id, house_geom(h.lng, h.lat) as g,
      m[1] as street,
      regexp_replace(m[2], '^(APT|UNIT|CONDO|STE|SUITE|BLDG|LOT|#)\s*\S+\s+', '') as locality,
      m[3] as zip
    from houses h,
    lateral regexp_match(h.normalized_address, '^\S+\s+(.+?\s(?:CT|COURT))\s+(.*?)\s*(?:MD)?\s*(\d{5})$') m
    where h.organization_id = org and h.kind = 'house' and not h.needs_review
      and not (h.lat = 0 and h.lng = 0)
      and h.normalized_address ~ '\s(CT|COURT)\s'
      and m[1] is not null
  ),
  shop as (
    select ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography as g
    from business_locations
    order by (name ilike '%shop%') desc, created_at asc
    limit 1
  ),
  house_stage as (
    select e.house_id,
      bool_or(e.kind in ('client', 'job_completed')) as is_client
    from property_events e
    where e.house_id in (select id from parsed)
    group by e.house_id
  ),
  contacts as (
    select distinct house_id from house_contacts where house_id in (select id from parsed)
  ),
  done as (
    select p.id as house_id, count(j.id) as jobs_done
    from parsed p join jobs j on j.property_id = p.property_id and j.status = 'completed'
    group by p.id
  ),
  grouped as (
    select p.street, p.zip,
      mode() within group (order by p.locality) as locality,
      count(*) as house_count,
      ST_Centroid(ST_Collect(p.g)) as centre,
      ST_Collect(p.g) as pts,
      percentile_cont(0.5) within group (order by o.assessed_value) as assessed_median,
      count(*) filter (where o.owner_occupied) as owner_occupied,
      count(o.house_id) as ownership_known,
      count(*) filter (where o.land_use like 'Residential (R)%') as detached,
      count(*) filter (where o.land_use like 'Town House%') as townhouse,
      count(*) filter (where o.land_use like 'Residential Condominium%') as condo,
      count(*) filter (where s.is_client or c.house_id is not null) as clients,
      count(*) filter (where s.house_id is not null or c.house_id is not null) as touched,
      coalesce(sum(d.jobs_done), 0) as jobs_done
    from parsed p
    left join house_ownership o on o.house_id = p.id
    left join house_stage s on s.house_id = p.id
    left join contacts c on c.house_id = p.id
    left join done d on d.house_id = p.id
    group by p.street, p.zip
    having count(*) >= 3
  ),
  shaped as (
    select g.*,
      ST_Buffer(ST_ConvexHull(g.pts)::geography, 22) as ring,
      (select max(ST_Distance(pt.geom::geography, g.centre::geography)) from ST_DumpPoints(g.pts) pt) as spread_m,
      (select ST_Distance(g.centre::geography, shop.g) / 1000.0 from shop) as shop_km
    from grouped g
  )
  insert into court_targets (organization_id, street, zip, locality, house_count, lat, lng, outline, spread_m,
    assessed_median, owner_occupied, ownership_known, detached, townhouse, condo, clients, touched, jobs_done, shop_km)
  select org, street, zip, locality, house_count, ST_Y(centre), ST_X(centre),
    (ST_AsGeoJSON(ST_ExteriorRing(ST_GeometryN(ST_CollectionExtract(ST_MakeValid(ring::geometry), 3), 1)), 7)::jsonb)->'coordinates',
    spread_m, assessed_median::integer, owner_occupied, ownership_known, detached, townhouse, condo, clients, touched, jobs_done, shop_km
  from shaped;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- 4. Count the houses inside a drawn outline, for the saved target's card.
create or replace function public.houses_in_ring_count(org uuid, ring jsonb)
returns integer
language sql stable
set search_path = public
as $$
  select count(*)::integer from houses_in_shape(org, ring, null);
$$;

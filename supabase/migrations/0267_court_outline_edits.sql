-- A court's outline as the office drew it.
--
-- The ring the build draws round a court is a hull round its house pins,
-- which is a fair guess and not always the shape somebody means. The office
-- can drag the corners into the shape it wants, and that shape is kept: a
-- rebuild refreshes the counts and the guessed ring but never touches a
-- ring a person drew, and never changes a court's id, so targets saved
-- against it stay attached.

alter table court_targets
  add column if not exists custom_outline jsonb,
  add column if not exists custom_outline_at timestamptz;

create or replace function public.court_targets_build(org uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
  started timestamptz := clock_timestamp();
begin
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
    assessed_median, owner_occupied, ownership_known, detached, townhouse, condo, clients, touched, jobs_done, shop_km, built_at)
  select org, street, zip, locality, house_count, ST_Y(centre), ST_X(centre),
    (ST_AsGeoJSON(ST_ExteriorRing(ST_GeometryN(ST_CollectionExtract(ST_MakeValid(ring::geometry), 3), 1)), 7)::jsonb)->'coordinates',
    spread_m, assessed_median::integer, owner_occupied, ownership_known, detached, townhouse, condo, clients, touched, jobs_done, shop_km, started
  from shaped
  on conflict (organization_id, street, zip) do update set
    locality = excluded.locality,
    house_count = excluded.house_count,
    lat = excluded.lat,
    lng = excluded.lng,
    outline = excluded.outline,
    spread_m = excluded.spread_m,
    assessed_median = excluded.assessed_median,
    owner_occupied = excluded.owner_occupied,
    ownership_known = excluded.ownership_known,
    detached = excluded.detached,
    townhouse = excluded.townhouse,
    condo = excluded.condo,
    clients = excluded.clients,
    touched = excluded.touched,
    jobs_done = excluded.jobs_done,
    shop_km = excluded.shop_km,
    built_at = excluded.built_at;

  get diagnostics n = row_count;

  -- A court that no longer parses out of the houses is gone.
  delete from court_targets where organization_id = org and built_at < started;

  return n;
end;
$$;

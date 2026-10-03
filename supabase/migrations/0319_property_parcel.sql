-- The county's property lines for a property, and the road it faces.
--
-- The pre-evaluation form shows the client a satellite photo of their own
-- lot with the property line drawn on it, and lights up the front yard, the
-- back, the sides or around the house as they pick them. The outline comes
-- from Harford County's Cadastral layer, fetched the first time the form is
-- opened and kept here, so nobody waits on the county twice.
alter table properties add column if not exists parcel jsonb;
alter table properties add column if not exists parcel_fetched_at timestamptz;

comment on column properties.parcel is
  'The county parcel: {ring: [[lng,lat],...], lotSqft, structureSqft, account, source}. Null when not fetched or not found.';

-- The nearest road to a point, preferring the street in the address, so a
-- corner lot faces the road it is numbered on. Roads are stored in local
-- metres (x = lng * cos(39.5 deg) * 111320, y = lat * 110574); the closest
-- point comes back in the same units. Driveways, tracks and footpaths are
-- not the road a house faces.
create or replace function nearest_road(p_lat double precision, p_lng double precision, p_street text default null)
returns table (name text, x double precision, y double precision, distance double precision)
language sql
stable
set search_path = public
as $$
  with p as (
    select point(p_lng * cos(radians(39.5)) * 111320, p_lat * 110574.0) as pt
  )
  select r.name, (p.pt ## r.seg)[0], (p.pt ## r.seg)[1], r.seg <-> p.pt
  from road_segments r, p
  where r.bbox && box(point(p.pt[0] - 250, p.pt[1] - 250), point(p.pt[0] + 250, p.pt[1] + 250))
    and r.highway not in ('service', 'track', 'pedestrian')
  order by
    (p_street is not null and length(p_street) > 2 and upper(coalesce(r.name, '')) like '%' || upper(p_street) || '%') desc,
    r.seg <-> p.pt
  limit 1;
$$;

grant execute on function nearest_road(double precision, double precision, text) to authenticated, service_role;

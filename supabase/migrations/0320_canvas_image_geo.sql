-- Where a site map's satellite photo was taken from, so the county's property
-- line and the house outline can be drawn on it in the right place.
--
-- {lng, lat, zoom, bearing, request, kept}: the map centre, the Mapbox zoom
-- and bearing the photo was asked for, the square size requested and the
-- height kept after trimming the attribution strip. Null for an uploaded
-- photo, which has no place on the map.
alter table canvas_designs add column if not exists image_geo jsonb;

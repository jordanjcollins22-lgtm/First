-- USPS does not draw a carrier route as a boundary. It draws it as the streets
-- the carrier walks: a bundle of short line segments, each with the route's
-- counts on it. The first live answer for ZIP 21014 was thirty routes of
-- polylines and not one polygon. So the streets are kept as they came, and the
-- boundary the map draws -- and hands to the wave form -- is worked out from
-- them: a hull around the street network, pushed out far enough to take in the
-- houses that stand back from the kerb.
ALTER TABLE eddm_routes ADD COLUMN IF NOT EXISTS paths JSONB;

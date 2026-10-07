-- USPS carrier routes, as the EDDM map service describes them.
--
-- A carrier route is the unit Every Door Direct Mail is sold by, and a
-- natural neighbourhood for a door-hanger walk. USPS draws them on its own
-- map from an ArcGIS server; this table keeps what that server said, per ZIP,
-- so the map can draw the routes without asking USPS on every load and so a
-- route still exists here if that undocumented service goes away. Everything
-- USPS sent about a route is kept in `attributes`; the three counts the
-- business reads are lifted out.
CREATE TABLE IF NOT EXISTS eddm_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  zip TEXT NOT NULL,
  -- USPS's route id, e.g. C012.
  route_id TEXT NOT NULL,
  residential_count INTEGER,
  business_count INTEGER,
  total_count INTEGER,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Rings of [lng, lat] pairs, WGS84.
  rings JSONB NOT NULL,
  source_url TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, zip, route_id)
);
CREATE INDEX IF NOT EXISTS eddm_routes_zip_idx ON eddm_routes (organization_id, zip);

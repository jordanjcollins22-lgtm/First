-- One row per attempt to talk to the county.
--
-- The county's GIS server can only be reached from where the app is deployed,
-- so everything the app learns there -- which fields the layer actually has,
-- what the server said when it refused, how far an import got before it
-- stopped -- is written here, where it can be read back from anywhere. A
-- connection test is a job that fetched nothing; an import is a job with a
-- checkpoint, and resuming it means reading that checkpoint and carrying on.
CREATE TABLE IF NOT EXISTS gis_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- connection_test | zip | county
  kind TEXT NOT NULL,
  -- queued | running | paused | done | failed
  status TEXT NOT NULL DEFAULT 'queued',
  -- { "zip": "21014" } for a bounded run; {} for the whole county.
  scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- What was typed in, and what was actually queried once discovery resolved
  -- a catalog or a service down to a single layer.
  service_url TEXT NOT NULL,
  layer_url TEXT,
  layer_name TEXT,
  max_record_count INTEGER,
  -- Every field the layer reported, exactly as reported. The mapping is which
  -- of them we decided to read for address, parcel id, owner, zip, land use.
  discovered_fields JSONB,
  field_mapping JSONB,
  layers_found JSONB,
  -- What the layer says it holds for this scope, before anything was fetched.
  total_expected INTEGER,
  fetched INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  matched INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  review INTEGER NOT NULL DEFAULT 0,
  duplicates_prevented INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  -- { "offset": 4000 }. Resuming starts here.
  checkpoint JSONB NOT NULL DEFAULT '{"offset": 0}'::jsonb,
  steps INTEGER NOT NULL DEFAULT 0,
  -- Held by whichever server process is working a page right now, so a second
  -- resume cannot run the same page twice.
  lease_until TIMESTAMPTZ,
  before_totals JSONB,
  after_totals JSONB,
  -- The exact request and the exact answer: url, status, body, error code,
  -- and where the request ran from. The thing to read when it did not work.
  diagnostics JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_error TEXT,
  started_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gis_import_jobs_org_idx
  ON gis_import_jobs (organization_id, created_at DESC);

-- The questions to ask after the county has been imported, answered in one
-- trip. Every one of them should be zero except the totals and the review
-- count, and a second run of the import must leave every number unchanged.
CREATE OR REPLACE FUNCTION gis_integrity_report(org UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'total_houses', (SELECT count(*) FROM houses h WHERE h.organization_id = org),
    'gis_linked_houses', (SELECT count(*) FROM houses h WHERE h.organization_id = org AND h.parcel_id IS NOT NULL),
    'total_events', (SELECT count(*) FROM property_events e WHERE e.organization_id = org),
    'duplicate_normalized_addresses', (
      SELECT count(*) FROM (
        SELECT normalized_address FROM houses h
        WHERE h.organization_id = org AND normalized_address IS NOT NULL AND normalized_address <> ''
        GROUP BY normalized_address HAVING count(*) > 1
      ) d
    ),
    'duplicate_parcel_ids', (
      SELECT count(*) FROM (
        SELECT county, parcel_id FROM houses h
        WHERE h.organization_id = org AND parcel_id IS NOT NULL
        GROUP BY county, parcel_id HAVING count(*) > 1
      ) d
    ),
    'houses_without_usable_coordinates', (
      SELECT count(*) FROM houses h
      WHERE h.organization_id = org
        AND (h.lat IS NULL OR h.lng IS NULL OR (h.lat = 0 AND h.lng = 0))
    ),
    'gis_houses_without_address', (
      SELECT count(*) FROM houses h
      WHERE h.organization_id = org AND h.parcel_id IS NOT NULL
        AND (h.address IS NULL OR btrim(h.address) = '')
    ),
    'gis_houses_without_normalized', (
      SELECT count(*) FROM houses h
      WHERE h.organization_id = org AND h.parcel_id IS NOT NULL
        AND (h.normalized_address IS NULL OR h.normalized_address = '')
    ),
    'detached_events', (
      SELECT count(*) FROM property_events e
      LEFT JOIN houses h ON h.id = e.house_id
      WHERE e.organization_id = org AND h.id IS NULL
    ),
    'pending_reviews', (
      SELECT count(*) FROM house_match_reviews r
      WHERE r.organization_id = org AND r.status = 'pending'
    ),
    'held_houses', (
      SELECT count(*) FROM houses h WHERE h.organization_id = org AND h.needs_review
    ),
    'checked_at', to_jsonb(now())
  );
$$;

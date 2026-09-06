-- Ordering EDDM from the app, as far as USPS lets anyone.
--
-- USPS has no way to place an EDDM order from outside its own site, so the
-- app does everything up to the payment: the routes, the piece count, the
-- postage at the rate USPS currently charges, the printing cost when the
-- printing is done in-house, the post office the bundles go to, and the
-- facing slip for every bundle. What is left for EDDM Online is one payment.
--
-- The postage rate is a setting, not a constant: USPS revises it once or
-- twice a year. The print cost is a setting because the business plans to
-- print in-house, and the cost of a mailing should say what it really costs.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS eddm_postage_per_piece NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS eddm_print_cost_per_piece NUMERIC(8,4) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS eddm_mailings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- residential | all. EDDM lets a mailer choose; the counts and cost differ.
  audience TEXT NOT NULL DEFAULT 'residential',
  -- [{ zip, routeId, residential, business, total, pieces, facility }]
  routes JSONB NOT NULL DEFAULT '[]'::jsonb,
  pieces INTEGER NOT NULL DEFAULT 0,
  -- The rates as they were when the mailing was priced.
  postage_per_piece NUMERIC(8,4),
  print_cost_per_piece NUMERIC(8,4) NOT NULL DEFAULT 0,
  postage_cents INTEGER NOT NULL DEFAULT 0,
  print_cost_cents INTEGER NOT NULL DEFAULT 0,
  drop_facilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- planned | printed | mailed
  status TEXT NOT NULL DEFAULT 'planned',
  mailed_on DATE,
  wave_id UUID REFERENCES attractor_waves(id) ON DELETE SET NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eddm_mailings_org_idx ON eddm_mailings (organization_id, created_at DESC);

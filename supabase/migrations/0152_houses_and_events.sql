-- The county gives us the house. Our own activity gradually enriches it.
--
-- Three things that were one thing before, and are not:
--
--   a house      one physical address, whether or not anybody has ever
--                spoken to whoever lives there
--   a contact    an actual person we know, which most houses do not have
--   an event     something that happened at a house on a date
--
-- Nearly every house in the county will have no contact and no events, and
-- that is the normal case rather than missing data: ninety thousand untouched
-- houses is the map of where the work is.
--
-- Relationship state is deliberately not a column anywhere. It is the
-- high-water mark of the event log, computed on read. A client who declines in
-- 2026 is still a former client, and a status field would have overwritten
-- that the moment they said no -- which is how somebody ends up knocking on
-- the door of a house that has already paid twice. Events are facts and cannot
-- become untrue; a status is a guess about which fact mattered, made once.

-- hanger_houses was named for the only thing that used it. It now holds every
-- parcel in the county, so it is houses.
ALTER TABLE IF EXISTS hanger_houses RENAME TO houses;
ALTER TABLE IF EXISTS hanger_zone_houses RENAME TO zone_houses;
ALTER TABLE IF EXISTS hanger_hangs RENAME TO door_hanger_events;

-- What the county knows about a house, kept apart from what we know.
ALTER TABLE houses
  -- The county's own key. Stabler than an address, which gets re-spelled.
  ADD COLUMN IF NOT EXISTS parcel_id TEXT,
  ADD COLUMN IF NOT EXISTS county TEXT,
  -- Public record, and supplemental property data rather than a contact. An
  -- owner name is not a lead: it is not permission to call, and it may be a
  -- trust, an estate, or three years out of date.
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS lot_size_sqft NUMERIC,
  -- The parcel outline, for drawing property lines under the marker.
  ADD COLUMN IF NOT EXISTS boundary JSONB,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ,
  -- Upper-cased, punctuation stripped, street types expanded. The only join
  -- available between a county parcel and a customer we already had.
  ADD COLUMN IF NOT EXISTS normalized_address TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS houses_parcel_idx
  ON houses (organization_id, county, parcel_id)
  WHERE parcel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS houses_normalized_idx ON houses (organization_id, normalized_address);

-- People, against the houses they belong to. A house can have several -- an
-- owner and a tenant, two names on a deed -- and a person can have several
-- houses, which is why this is a join and not a column on either side.
CREATE TABLE IF NOT EXISTS house_contacts (
  house_id UUID NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (house_id, customer_id)
);

-- What happened, and when. Append-only in spirit: correcting history means
-- adding to it, because the whole point is that nothing here gets overwritten.
CREATE TABLE IF NOT EXISTS property_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  house_id UUID NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  -- spoken_to, evaluation, proposal, client, job_completed. Ranked in
  -- src/lib/house-relationship.ts, which is where the order lives.
  kind TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  amount_cents INTEGER,
  note TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS property_events_house_idx ON property_events (house_id, occurred_at);
CREATE INDEX IF NOT EXISTS house_contacts_customer_idx ON house_contacts (customer_id);

-- Near-misses, for a person to settle.
--
-- An exact normalized match links itself. Anything short of that lands here
-- rather than being merged on a hunch: quietly attaching a stranger's parcel
-- to a customer record puts the wrong name on a proposal, and nobody finds out
-- until a client reads it.
CREATE TABLE IF NOT EXISTS house_match_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  house_id UUID NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  /* 0 to 1. How close the two addresses were. */
  score NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS house_match_reviews_pending_idx
  ON house_match_reviews (organization_id, status);

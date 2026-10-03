-- Settling a county near-match needs what the county said about the parcel,
-- not just its address: a reviewer who decides "different house" wants that
-- house created on the spot, with its pin, rather than told to re-run the
-- county. The review row therefore keeps the parcel's coordinates, and
-- records how it was settled and what came of it.
ALTER TABLE house_match_reviews
  ADD COLUMN IF NOT EXISTS incoming_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS incoming_lng DOUBLE PRECISION,
  -- same_house | different | (null while pending)
  ADD COLUMN IF NOT EXISTS resolution TEXT,
  -- The house made when the answer was "different".
  ADD COLUMN IF NOT EXISTS created_house_id UUID REFERENCES houses(id) ON DELETE SET NULL;

-- The importer asks, per page, which of its candidates already have an open
-- or settled question. Rejected ones matter as much as pending: a parcel a
-- person has already said is a different house must not be asked about again.
CREATE INDEX IF NOT EXISTS house_match_reviews_house_status_idx
  ON house_match_reviews (house_id, status);

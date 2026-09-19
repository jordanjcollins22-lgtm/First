-- A near match from the county has no property or customer on the other side
-- of it, only a parcel. Without somewhere to put the incoming address a
-- reviewer sees "something was close to this house" and no way to judge it.
ALTER TABLE house_match_reviews
  ADD COLUMN IF NOT EXISTS incoming_address TEXT,
  ADD COLUMN IF NOT EXISTS incoming_normalized TEXT,
  ADD COLUMN IF NOT EXISTS parcel_id TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT;

-- One open question per house per incoming address. Re-running the import
-- must not stack the same question up again, which is half of what makes the
-- second run a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS house_match_reviews_open_idx
  ON house_match_reviews (house_id, incoming_normalized)
  WHERE status = 'pending';

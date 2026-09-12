-- When somebody settled a held address, and who.
--
-- needs_review is "in the queue"; reviewed_at is "a person has looked". Both
-- are needed: a house that was held, looked at, and deliberately left off the
-- map is a different thing from one nobody has reached yet, and only the
-- second kind is worth putting in front of somebody.
ALTER TABLE houses
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN houses.needs_review IS
  'In the review queue. A house is mappable when kind = house AND NOT needs_review.';

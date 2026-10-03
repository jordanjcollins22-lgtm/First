-- Identity is the normalized address text. Coordinates are enrichment.
--
-- The property table held a Bel Air street geocoded to Milan, Missouri,
-- another to Port Macquarie, and one to Austria. The text was right every
-- time. Keying on coordinates would have made three houses on three continents
-- out of one street in Harford County.
ALTER TABLE houses
  -- Which version of the normalizer produced normalized_address, so a later
  -- improvement regenerates exactly the rows it changes rather than everything
  -- or nothing. src/lib/address-quality.ts owns the number.
  ADD COLUMN IF NOT EXISTS address_normalizer_version INTEGER NOT NULL DEFAULT 0,
  -- house | street | unusable. A street is not one address: a single pin on a
  -- road with four hundred houses makes every count that pin feeds wrong.
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'house',
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_reason TEXT,
  -- The county's own address text, kept apart so importing never overwrites
  -- the raw string somebody originally typed.
  ADD COLUMN IF NOT EXISTS gis_address TEXT,
  ADD COLUMN IF NOT EXISTS gis_matched_at TIMESTAMPTZ;

COMMENT ON COLUMN houses.address IS
  'The raw address as first received. Never overwritten; the county''s version goes in gis_address.';
COMMENT ON COLUMN houses.normalized_address IS
  'Canonical matching key. src/lib/address-normalize.ts is the only long-term implementation; the SQL normalize_address() exists for the backfill alone.';

CREATE INDEX IF NOT EXISTS houses_review_idx ON houses (organization_id, needs_review) WHERE needs_review;

-- Classify what is already here. Mirrors assessAddress() in TypeScript, which
-- is canonical; this runs once.
UPDATE houses SET
  address_normalizer_version = 1,
  kind = CASE
    WHEN coalesce(normalized_address, '') = '' THEN 'unusable'
    WHEN normalized_address ~ '^[0-9]+[A-Z]?( |$)' THEN 'house'
    ELSE 'street'
  END;

UPDATE houses h SET
  needs_review = true,
  review_reason = CASE
    WHEN h.kind = 'street' THEN 'A street with no house number, not a single address'
    WHEN h.kind = 'unusable' THEN 'No usable address'
    ELSE 'Address says Harford County but the pin is far outside it'
  END
WHERE h.kind <> 'house'
   OR (
     (
       substring(h.normalized_address from '\m(21001|21005|21009|21014|21015|21017|21028|21034|21040|21047|21050|21078|21084|21085|21130|21132|21154|21160)\M') IS NOT NULL
       OR (h.normalized_address ~ '\mMD\M' AND h.normalized_address ~ '\m(ABERDEEN|ABINGDON|BEL AIR|BELCAMP|CHURCHVILLE|DARLINGTON|EDGEWOOD|FALLSTON|FOREST HILL|HAVRE DE GRACE|JARRETTSVILLE|JOPPA|PERRYMAN|PYLESVILLE|WHITEFORD)\M')
     )
     AND h.lat IS NOT NULL AND h.lng IS NOT NULL
     AND NOT (h.lat BETWEEN 39.3 AND 39.75 AND h.lng BETWEEN -76.6 AND -75.98)
   );

-- The rule the mismatch check cannot see. The geocoder did not merely move a
-- pin, it rewrote the address: "907 Red Pump Road, Bel Air" came back as "Red
-- Pump Road, Milan, Missouri", and "319 Crestwood Drive, Edgewood" as the same
-- house number and street in Port Macquarie. Nothing claims Harford any more,
-- so distance is all that is left to notice it by.
WITH dist AS (
  SELECT id,
    6371000 * acos(least(1, greatest(-1,
      sin(radians(39.5359))*sin(radians(lat)) +
      cos(radians(39.5359))*cos(radians(lat))*cos(radians(lng + 76.3483))
    ))) AS metres
  FROM houses WHERE lat IS NOT NULL AND lng IS NOT NULL
)
UPDATE houses h SET
  needs_review = true,
  review_reason = coalesce(h.review_reason,
    'Pinned about ' || round(d.metres / 1609.344)::int || ' miles from the service area')
FROM dist d
WHERE d.id = h.id AND d.metres > 150 * 1609.344;

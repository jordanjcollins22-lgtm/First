-- Every existing property becomes a canonical house, and its history becomes
-- events on that house.
--
-- The point of doing this before the county import is that the GIS parcels
-- must land on these same rows. The join is normalized_address, so this and
-- the importer have to agree on it exactly -- which is why the normalizer is
-- written twice, once here for the one-time backfill and once in
-- src/lib/address-normalize.ts, which is canonical and owns every address
-- written from now on. The two were checked against each other on real
-- addresses before this ran, including the ones that break naive parsers: a
-- Harford town actually named Street, West Virginia, ZIP+4, and a direction
-- inside a town name.
--
-- Written to be safe to run twice. The event inserts guard on NOT EXISTS
-- rather than relying on having been run once, because a backfill that
-- silently doubles somebody's history the second time it is run is worse than
-- one that does nothing.

CREATE OR REPLACE FUNCTION normalize_address(raw TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  t TEXT; words TEXT[]; out_words TEXT[] := '{}'; w TEXT; m TEXT; i INT;
BEGIN
  IF raw IS NULL OR btrim(raw) = '' THEN RETURN ''; END IF;
  t := upper(raw);
  t := regexp_replace(t, '(\d{5})-\d{4}', '\1', 'g');
  t := regexp_replace(t, '#\s*', 'UNIT ', 'g');
  t := regexp_replace(t, '[.,]', ' ', 'g');
  t := regexp_replace(t, '[^A-Z0-9\s-]', ' ', 'g');
  t := btrim(regexp_replace(t, '\s+', ' ', 'g'));
  FOREACH m IN ARRAY ARRAY['UNITED STATES OF AMERICA','UNITED STATES','USA','US'] LOOP
    IF t LIKE ('% ' || m) THEN t := left(t, length(t) - length(m) - 1); EXIT; END IF;
  END LOOP;
  t := regexp_replace(t, '(^|\s)NEW HAMPSHIRE(\s|$)', '\1NH\2', 'g');
  t := regexp_replace(t, '(^|\s)NEW JERSEY(\s|$)', '\1NJ\2', 'g');
  t := regexp_replace(t, '(^|\s)NEW MEXICO(\s|$)', '\1NM\2', 'g');
  t := regexp_replace(t, '(^|\s)NEW YORK(\s|$)', '\1NY\2', 'g');
  t := regexp_replace(t, '(^|\s)NORTH CAROLINA(\s|$)', '\1NC\2', 'g');
  t := regexp_replace(t, '(^|\s)NORTH DAKOTA(\s|$)', '\1ND\2', 'g');
  t := regexp_replace(t, '(^|\s)RHODE ISLAND(\s|$)', '\1RI\2', 'g');
  t := regexp_replace(t, '(^|\s)SOUTH CAROLINA(\s|$)', '\1SC\2', 'g');
  t := regexp_replace(t, '(^|\s)SOUTH DAKOTA(\s|$)', '\1SD\2', 'g');
  t := regexp_replace(t, '(^|\s)WEST VIRGINIA(\s|$)', '\1WV\2', 'g');
  t := regexp_replace(t, '(^|\s)DISTRICT OF COLUMBIA(\s|$)', '\1DC\2', 'g');
  words := string_to_array(t, ' ');
  FOR i IN 1 .. coalesce(array_length(words, 1), 0) LOOP
    w := words[i];
    IF w = '' THEN CONTINUE; END IF;
    -- The first word is never mapped: a street can be named North.
    IF i > 1 THEN
      w := CASE w
        WHEN 'ALLEY' THEN 'ALY' WHEN 'AVENUE' THEN 'AVE' WHEN 'AV' THEN 'AVE'
        WHEN 'BOULEVARD' THEN 'BLVD' WHEN 'BOUL' THEN 'BLVD'
        WHEN 'CIRCLE' THEN 'CIR' WHEN 'CIRC' THEN 'CIR'
        WHEN 'COURT' THEN 'CT' WHEN 'COVE' THEN 'CV' WHEN 'CRESCENT' THEN 'CRES'
        WHEN 'CROSSING' THEN 'XING' WHEN 'DRIVE' THEN 'DR' WHEN 'DRV' THEN 'DR'
        WHEN 'EXPRESSWAY' THEN 'EXPY' WHEN 'EXTENSION' THEN 'EXT'
        WHEN 'FREEWAY' THEN 'FWY' WHEN 'GARDENS' THEN 'GDNS' WHEN 'GREEN' THEN 'GRN'
        WHEN 'GROVE' THEN 'GRV' WHEN 'HEIGHTS' THEN 'HTS' WHEN 'HIGHWAY' THEN 'HWY'
        WHEN 'HOLLOW' THEN 'HOLW' WHEN 'JUNCTION' THEN 'JCT' WHEN 'LANE' THEN 'LN'
        WHEN 'MANOR' THEN 'MNR' WHEN 'MEADOWS' THEN 'MDWS' WHEN 'MOUNT' THEN 'MT'
        WHEN 'MOUNTAIN' THEN 'MTN' WHEN 'PARKWAY' THEN 'PKWY' WHEN 'PARKWY' THEN 'PKWY'
        WHEN 'PLACE' THEN 'PL' WHEN 'PLAZA' THEN 'PLZ' WHEN 'POINT' THEN 'PT'
        WHEN 'RIDGE' THEN 'RDG' WHEN 'ROAD' THEN 'RD' WHEN 'ROUTE' THEN 'RTE'
        WHEN 'SQUARE' THEN 'SQ' WHEN 'STREET' THEN 'ST' WHEN 'STR' THEN 'ST'
        WHEN 'TERRACE' THEN 'TER' WHEN 'TRACE' THEN 'TRCE' WHEN 'TRAIL' THEN 'TRL'
        WHEN 'TURNPIKE' THEN 'TPKE' WHEN 'VALLEY' THEN 'VLY' WHEN 'VIEW' THEN 'VW'
        WHEN 'VILLAGE' THEN 'VLG'
        WHEN 'NORTH' THEN 'N' WHEN 'SOUTH' THEN 'S' WHEN 'EAST' THEN 'E' WHEN 'WEST' THEN 'W'
        WHEN 'NORTHEAST' THEN 'NE' WHEN 'NORTHWEST' THEN 'NW'
        WHEN 'SOUTHEAST' THEN 'SE' WHEN 'SOUTHWEST' THEN 'SW'
        WHEN 'APARTMENT' THEN 'APT' WHEN 'SUITE' THEN 'STE' WHEN 'BUILDING' THEN 'BLDG'
        WHEN 'FLOOR' THEN 'FL' WHEN 'ROOM' THEN 'RM' WHEN 'TRAILER' THEN 'TRLR'
        WHEN 'ALABAMA' THEN 'AL' WHEN 'ALASKA' THEN 'AK' WHEN 'ARIZONA' THEN 'AZ'
        WHEN 'ARKANSAS' THEN 'AR' WHEN 'CALIFORNIA' THEN 'CA' WHEN 'COLORADO' THEN 'CO'
        WHEN 'CONNECTICUT' THEN 'CT' WHEN 'DELAWARE' THEN 'DE' WHEN 'FLORIDA' THEN 'FL'
        WHEN 'GEORGIA' THEN 'GA' WHEN 'HAWAII' THEN 'HI' WHEN 'IDAHO' THEN 'ID'
        WHEN 'ILLINOIS' THEN 'IL' WHEN 'INDIANA' THEN 'IN' WHEN 'IOWA' THEN 'IA'
        WHEN 'KANSAS' THEN 'KS' WHEN 'KENTUCKY' THEN 'KY' WHEN 'LOUISIANA' THEN 'LA'
        WHEN 'MAINE' THEN 'ME' WHEN 'MARYLAND' THEN 'MD' WHEN 'MASSACHUSETTS' THEN 'MA'
        WHEN 'MICHIGAN' THEN 'MI' WHEN 'MINNESOTA' THEN 'MN' WHEN 'MISSISSIPPI' THEN 'MS'
        WHEN 'MISSOURI' THEN 'MO' WHEN 'MONTANA' THEN 'MT' WHEN 'NEBRASKA' THEN 'NE'
        WHEN 'NEVADA' THEN 'NV' WHEN 'OHIO' THEN 'OH' WHEN 'OKLAHOMA' THEN 'OK'
        WHEN 'OREGON' THEN 'OR' WHEN 'PENNSYLVANIA' THEN 'PA' WHEN 'TENNESSEE' THEN 'TN'
        WHEN 'TEXAS' THEN 'TX' WHEN 'UTAH' THEN 'UT' WHEN 'VERMONT' THEN 'VT'
        WHEN 'VIRGINIA' THEN 'VA' WHEN 'WASHINGTON' THEN 'WA' WHEN 'WISCONSIN' THEN 'WI'
        WHEN 'WYOMING' THEN 'WY'
        ELSE w END;
    END IF;
    out_words := array_append(out_words, w);
  END LOOP;
  RETURN btrim(regexp_replace(array_to_string(out_words, ' '), '\s+', ' ', 'g'));
END;
$fn$;

-- One house per distinct address. The CRM already held the same address twice
-- in several places; those collapse here, which is the point of canonical.
INSERT INTO houses (organization_id, address, lat, lng, property_id, normalized_address, source, source_updated_at)
SELECT DISTINCT ON (normalize_address(p.address))
  c.organization_id, p.address, p.lat, p.lng, p.id,
  normalize_address(p.address), 'crm', now()
FROM properties p
JOIN customers c ON c.id = p.customer_id
WHERE normalize_address(p.address) <> ''
ORDER BY normalize_address(p.address), p.created_at
ON CONFLICT (organization_id, address) DO NOTHING;

-- The key the county import will join on.
CREATE UNIQUE INDEX IF NOT EXISTS houses_normalized_unique
  ON houses (organization_id, normalized_address);

INSERT INTO house_contacts (house_id, customer_id, role)
SELECT DISTINCT h.id, p.customer_id, 'owner'
FROM properties p
JOIN customers c ON c.id = p.customer_id
JOIN houses h ON h.organization_id = c.organization_id
             AND h.normalized_address = normalize_address(p.address)
WHERE normalize_address(p.address) <> ''
ON CONFLICT DO NOTHING;

CREATE OR REPLACE VIEW job_house AS
SELECT j.id AS job_id, h.id AS house_id, h.organization_id
FROM jobs j
JOIN properties p ON p.id = j.property_id
JOIN customers c ON c.id = p.customer_id
JOIN houses h ON h.organization_id = c.organization_id
             AND h.normalized_address = normalize_address(p.address);

-- Derived from what actually happened, never from contact_type: that field
-- called 1,745 contacts clients when exactly one had paid.
INSERT INTO property_events (organization_id, house_id, kind, occurred_at, job_id)
SELECT jh.organization_id, jh.house_id, 'evaluation', j.evaluation_date, j.id
FROM jobs j JOIN job_house jh ON jh.job_id = j.id
WHERE j.evaluation_date IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM property_events e
                  WHERE e.job_id = j.id AND e.kind = 'evaluation');

INSERT INTO property_events (organization_id, house_id, kind, occurred_at, job_id)
SELECT jh.organization_id, jh.house_id, 'proposal', coalesce(pr.approved_at, pr.generated_at), pr.job_id
FROM job_proposals pr JOIN job_house jh ON jh.job_id = pr.job_id
WHERE (pr.status IN ('sent','accepted','declined') OR pr.approved_at IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM property_events e
                  WHERE e.job_id = pr.job_id AND e.kind = 'proposal');

INSERT INTO property_events (organization_id, house_id, kind, occurred_at, job_id, amount_cents)
SELECT jh.organization_id, jh.house_id, 'client', pr.paid_at, pr.job_id,
       round(coalesce(pr.total_cost,0) * 100)::int
FROM job_proposals pr JOIN job_house jh ON jh.job_id = pr.job_id
WHERE pr.paid_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM property_events e
                  WHERE e.job_id = pr.job_id AND e.kind = 'client');

INSERT INTO property_events (organization_id, house_id, kind, occurred_at, job_id)
SELECT jh.organization_id, jh.house_id, 'job_completed', coalesce(j.completed_at, j.updated_at), j.id
FROM jobs j JOIN job_house jh ON jh.job_id = j.id
WHERE (j.completed_at IS NOT NULL OR j.status = 'completed')
  AND NOT EXISTS (SELECT 1 FROM property_events e
                  WHERE e.job_id = j.id AND e.kind = 'job_completed');

INSERT INTO property_events (organization_id, house_id, kind, occurred_at, job_id)
SELECT jh.organization_id, jh.house_id, 'spoken_to', min(m.created_at), m.job_id
FROM job_messages m JOIN job_house jh ON jh.job_id = m.job_id
WHERE NOT EXISTS (SELECT 1 FROM property_events e
                  WHERE e.job_id = m.job_id AND e.kind = 'spoken_to')
GROUP BY jh.house_id, jh.organization_id, m.job_id;

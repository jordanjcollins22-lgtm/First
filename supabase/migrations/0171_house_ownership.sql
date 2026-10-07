-- Who owns each house, from the State's assessment roll.
--
-- Maryland's SDAT publishes every parcel: the owner's name, where the tax
-- bill is mailed, whether the owner claims it as their principal residence,
-- the last transfer and what was paid. From that, per house: is it lived in
-- by its owner or rented out, and did it just change hands. Kept in its own
-- table rather than on houses, because a hundred thousand row rewrites on a
-- table with a trigram index is a slow evening, and this changes on its own
-- schedule.
CREATE TABLE IF NOT EXISTS house_ownership (
  house_id UUID PRIMARY KEY REFERENCES houses(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  account_id TEXT,
  owner_name TEXT,
  owner_mailing TEXT,
  -- true owner-occupied, false absentee (rented or held), null unknown.
  owner_occupied BOOLEAN,
  occupancy_reason TEXT,
  principal_residence BOOLEAN,
  last_sale_date DATE,
  last_sale_price INTEGER,
  year_built INTEGER,
  land_use TEXT,
  assessed_value INTEGER,
  source_layer TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS house_ownership_org_idx ON house_ownership (organization_id, owner_occupied);
CREATE INDEX IF NOT EXISTS house_ownership_sale_idx ON house_ownership (organization_id, last_sale_date DESC);

-- The map's points now carry ownership too:
-- [lng, lat, stageRank, ownership, soldRecently] with ownership 0 unknown,
-- 1 owner-occupied, 2 absentee; soldRecently 1 within the last year.
CREATE OR REPLACE FUNCTION houses_map_points(org UUID)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  WITH ranks AS (
    SELECT e.house_id,
           max(CASE e.kind WHEN 'spoken_to' THEN 1 WHEN 'evaluation' THEN 2 WHEN 'proposal' THEN 3
                           WHEN 'client' THEN 4 WHEN 'job_completed' THEN 5 ELSE 0 END) AS rank
    FROM property_events e WHERE e.organization_id = org GROUP BY e.house_id
  ),
  known AS (SELECT DISTINCT c.house_id FROM house_contacts c)
  SELECT coalesce(jsonb_agg(jsonb_build_array(
           round(h.lng::numeric, 6), round(h.lat::numeric, 6),
           greatest(coalesce(r.rank, 0), CASE WHEN k.house_id IS NOT NULL THEN 1 ELSE 0 END),
           CASE o.owner_occupied WHEN true THEN 1 WHEN false THEN 2 ELSE 0 END,
           CASE WHEN o.last_sale_date >= current_date - 365 THEN 1 ELSE 0 END
         )), '[]'::jsonb)
  FROM houses h
  LEFT JOIN ranks r ON r.house_id = h.id
  LEFT JOIN known k ON k.house_id = h.id
  LEFT JOIN house_ownership o ON o.house_id = h.id
  WHERE h.organization_id = org AND h.kind = 'house' AND NOT h.needs_review
    AND NOT (h.lat = 0 AND h.lng = 0);
$$;

-- The county at a glance: how many houses we know the owner of, how many
-- are lived in by them, how many changed hands lately.
CREATE OR REPLACE FUNCTION ownership_summary(org UUID)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'houses', (SELECT count(*) FROM houses h WHERE h.organization_id = org AND h.kind = 'house' AND NOT h.needs_review),
    'known', count(*),
    'ownerOccupied', count(*) FILTER (WHERE o.owner_occupied),
    'absentee', count(*) FILTER (WHERE o.owner_occupied = false),
    'soldLastYear', count(*) FILTER (WHERE o.last_sale_date >= current_date - 365),
    'soldLast90', count(*) FILTER (WHERE o.last_sale_date >= current_date - 90),
    'fetchedAt', max(o.fetched_at)
  )
  FROM house_ownership o WHERE o.organization_id = org;
$$;

-- The door list says whose door it is: owner-occupied, absentee, or unknown,
-- and when it last sold. [id, address, rank, hangs, dnc, design, lat, lng, ownership, lastSale]
CREATE OR REPLACE FUNCTION houses_door_list(org UUID, ring JSONB, zips JSONB, designs INTEGER DEFAULT 1, max_rows INTEGER DEFAULT 20000)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_array(
           r.id, r.address, r.rank, r.hangs, r.dnc, least(r.hangs + 1, greatest(1, designs)), r.lat, r.lng,
           CASE o.owner_occupied WHEN true THEN 'owner' WHEN false THEN 'absentee' ELSE '' END,
           o.last_sale_date
         ) ORDER BY r.address), '[]'::jsonb)
  FROM (SELECT * FROM houses_in_shape(org, ring, zips) LIMIT max_rows) r
  LEFT JOIN house_ownership o ON o.house_id = r.id;
$$;

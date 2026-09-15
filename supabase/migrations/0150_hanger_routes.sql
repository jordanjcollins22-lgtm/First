-- Door hangers, tracked per house.
--
-- The business puts hangers out around every evaluation and every job, so the
-- neighbours of somebody who just bought see the work. What goes on a door
-- depends on how many times we have been to that door before: the first is an
-- introduction, the second says we are back, and so on. That only works if the
-- history belongs to the house.
--
-- Which is why a house is not owned by a zone. Zones get redrawn, and one
-- house falls inside two of them soon enough; if history hung off the zone it
-- would quietly reset and the whole street would get the introduction again.
-- The house is the durable thing, keyed by its address, and a zone merely
-- includes it.
--
-- "Zone" is the business's word for the area being walked. It is also, in this
-- codebase, a work area on the canvas -- so it is `hanger_zone` everywhere in
-- the schema and the code, and plain "zone" on screen where the context is
-- obvious. One word meaning two things in a table name is a bug waiting to be
-- written.

-- A named group of zones: what somebody walks, or a campaign area.
CREATE TABLE IF NOT EXISTS hanger_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- The work that caused this route to exist, where there was some. Null for a
  -- route drawn cold off an income map rather than seeded by a job.
  seed_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  notes TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One neighbourhood inside a route.
CREATE TABLE IF NOT EXISTS hanger_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  route_id UUID NOT NULL REFERENCES hanger_routes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- The same geometry vocabulary attractor waves already use, so the map can
  -- draw both without learning a second shape language.
  geometry_type TEXT NOT NULL DEFAULT 'point_radius',
  geometry JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Walking order within the route.
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One house, for as long as the business exists. See the note above.
CREATE TABLE IF NOT EXISTS hanger_houses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  lat NUMERIC NOT NULL,
  lng NUMERIC NOT NULL,
  -- Set once this house is somebody we know, so a hanger history and a
  -- customer history are the same story.
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, address)
);

-- Which houses a zone covers. A join rather than a column, because a house
-- outlives the zones drawn around it.
CREATE TABLE IF NOT EXISTS hanger_zone_houses (
  zone_id UUID NOT NULL REFERENCES hanger_zones(id) ON DELETE CASCADE,
  house_id UUID NOT NULL REFERENCES hanger_houses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (zone_id, house_id)
);

-- One hanger, on one door. This is the history that decides what the next one
-- says, and the count of what was actually delivered.
CREATE TABLE IF NOT EXISTS hanger_hangs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  house_id UUID NOT NULL REFERENCES hanger_houses(id) ON DELETE CASCADE,
  -- Kept even though it is reachable through the house, because "what did we
  -- deliver on that route" is asked far more often than it is derived.
  zone_id UUID REFERENCES hanger_zones(id) ON DELETE SET NULL,
  -- 1 for the first hanger this door ever got, 2 for the next, and so on.
  design_number INTEGER NOT NULL,
  hung_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hung_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hanger_zones_route_idx ON hanger_zones (route_id);
CREATE INDEX IF NOT EXISTS hanger_houses_org_idx ON hanger_houses (organization_id);
CREATE INDEX IF NOT EXISTS hanger_hangs_house_idx ON hanger_hangs (house_id);
CREATE INDEX IF NOT EXISTS hanger_hangs_zone_idx ON hanger_hangs (zone_id);

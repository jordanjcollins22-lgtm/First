-- The marketing that follows every evaluation and every new client, as a
-- list to tick off rather than a thing somebody has to remember.
--
-- An evaluation is a reason to put door hangers round the house: the
-- neighbours saw the truck. A new client is a reason for the full set: a
-- yard sign, five doors knocked (next door each way and the three across),
-- a hundred door hangers in the house's zone, and a thousand flyers by
-- EDDM on the USPS routes round it. Nobody types any of it. A sync reads
-- the jobs and the money, writes the plays that are missing, works out
-- which doors and which routes from the house itself, and the office ticks
-- each one off when it is done. Ticking off the hangers records them on
-- every door, so the map and the next print run know.
--
-- The numbers are what the business asked for and are stored per play, so
-- changing the recipe later does not rewrite what was already promised.

ALTER TABLE public.organizations
  -- Plays are made for evaluations and clients from this moment on; the
  -- book's history is not a to-do list.
  ADD COLUMN IF NOT EXISTS marketing_since TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.marketing_plays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  house_id UUID NOT NULL REFERENCES public.houses(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  -- evaluation | client: what set this off.
  reason TEXT NOT NULL CHECK (reason IN ('evaluation', 'client')),
  -- yard_sign | knocks | door_hangers | flyers
  kind TEXT NOT NULL CHECK (kind IN ('yard_sign', 'knocks', 'door_hangers', 'flyers')),
  -- Signs, doors, hangers or flyer pieces, as worked out when it was made.
  quantity INTEGER NOT NULL DEFAULT 0,
  zone_id UUID REFERENCES public.hanger_zones(id) ON DELETE SET NULL,
  -- House ids for doors; [{zip, routeId, pieces, ...}] for flyers.
  targets JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- open | done | skipped
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'skipped')),
  done_at TIMESTAMPTZ,
  done_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- The EDDM mailing made for a flyers play, once somebody makes it.
  mailing_id UUID REFERENCES public.eddm_mailings(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (house_id, reason, kind)
);
CREATE INDEX IF NOT EXISTS marketing_plays_org_status_idx ON public.marketing_plays (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS marketing_plays_house_idx ON public.marketing_plays (house_id);
CREATE INDEX IF NOT EXISTS zone_houses_zone_idx ON public.zone_houses (zone_id);

-- "208 CRAFTON RD BEL AIR MD 21014": the number, and the street with the
-- number taken off, which is what "same street" means.
CREATE OR REPLACE FUNCTION public.marketing_house_number(addr TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN addr ~ '^\d{1,6}\D' THEN (substring(addr from '^(\d{1,6})'))::integer END;
$$;
CREATE OR REPLACE FUNCTION public.marketing_street_key(addr TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(coalesce(addr, ''), '^\d{1,6}[A-Z]?\s+', '');
$$;

-- The five doors to knock: next door each way (same side of the street,
-- the nearest number below and above) and the three across (the other
-- side, nearest by number). A street the county numbers oddly, or a house
-- with no number, falls back to the nearest doors by distance, so there
-- are always five when five exist within three hundred metres.
CREATE OR REPLACE FUNCTION public.marketing_knock_targets(the_house UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE h RECORD; num INTEGER; street TEXT; picked UUID[] := '{}'; r RECORD; box geometry;
BEGIN
  SELECT * INTO h FROM houses WHERE id = the_house;
  IF h.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  num := marketing_house_number(h.normalized_address);
  street := marketing_street_key(h.normalized_address);
  box := ST_Expand(house_geom(h.lng, h.lat), 0.0035);
  IF num IS NOT NULL THEN
    FOR r IN
      (SELECT n.id FROM houses n
       WHERE n.organization_id = h.organization_id AND n.id <> h.id AND n.kind = 'house' AND NOT n.needs_review
         AND house_geom(n.lng, n.lat) && box
         AND marketing_street_key(n.normalized_address) = street
         AND marketing_house_number(n.normalized_address) % 2 = num % 2
         AND marketing_house_number(n.normalized_address) < num
       ORDER BY marketing_house_number(n.normalized_address) DESC LIMIT 1)
      UNION ALL
      (SELECT n.id FROM houses n
       WHERE n.organization_id = h.organization_id AND n.id <> h.id AND n.kind = 'house' AND NOT n.needs_review
         AND house_geom(n.lng, n.lat) && box
         AND marketing_street_key(n.normalized_address) = street
         AND marketing_house_number(n.normalized_address) % 2 = num % 2
         AND marketing_house_number(n.normalized_address) > num
       ORDER BY marketing_house_number(n.normalized_address) ASC LIMIT 1)
    LOOP picked := picked || r.id; END LOOP;
    FOR r IN
      SELECT n.id FROM houses n
      WHERE n.organization_id = h.organization_id AND n.id <> h.id AND n.kind = 'house' AND NOT n.needs_review
        AND house_geom(n.lng, n.lat) && box
        AND marketing_street_key(n.normalized_address) = street
        AND marketing_house_number(n.normalized_address) % 2 <> num % 2
      ORDER BY abs(marketing_house_number(n.normalized_address) - num), house_geom(n.lng, n.lat) <-> house_geom(h.lng, h.lat)
      LIMIT 3
    LOOP picked := picked || r.id; END LOOP;
  END IF;
  FOR r IN
    SELECT n.id FROM houses n
    WHERE n.organization_id = h.organization_id AND n.id <> h.id AND n.kind = 'house' AND NOT n.needs_review
      AND house_geom(n.lng, n.lat) && box AND NOT (n.id = ANY (picked))
      AND ST_DWithin(house_geom(n.lng, n.lat)::geography, house_geom(h.lng, h.lat)::geography, 300)
    ORDER BY house_geom(n.lng, n.lat) <-> house_geom(h.lng, h.lat)
    LIMIT 5
  LOOP
    EXIT WHEN coalesce(array_length(picked, 1), 0) >= 5;
    picked := picked || r.id;
  END LOOP;
  RETURN coalesce((SELECT jsonb_agg(p) FROM unnest(picked) p), '[]'::jsonb);
END $$;

-- The doors for a hundred hangers: the nearest in the house's own zone,
-- so the walk is the zone's walk. A house in no zone gets its nearest
-- neighbours within six hundred metres.
CREATE OR REPLACE FUNCTION public.marketing_hanger_targets(the_house UUID, wanted INTEGER DEFAULT 100)
RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE h RECORD; z UUID; out JSONB;
BEGIN
  SELECT * INTO h FROM houses WHERE id = the_house;
  IF h.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT zone_id INTO z FROM zone_houses WHERE house_id = the_house LIMIT 1;
  IF z IS NOT NULL THEN
    SELECT jsonb_agg(id) INTO out FROM (
      SELECT n.id FROM zone_houses zh JOIN houses n ON n.id = zh.house_id
      WHERE zh.zone_id = z AND n.id <> h.id AND n.kind = 'house' AND NOT n.needs_review
      ORDER BY house_geom(n.lng, n.lat) <-> house_geom(h.lng, h.lat) LIMIT wanted) s;
  ELSE
    SELECT jsonb_agg(id) INTO out FROM (
      SELECT n.id FROM houses n
      WHERE n.organization_id = h.organization_id AND n.id <> h.id AND n.kind = 'house' AND NOT n.needs_review
        AND house_geom(n.lng, n.lat) && ST_Expand(house_geom(h.lng, h.lat), 0.007)
        AND ST_DWithin(house_geom(n.lng, n.lat)::geography, house_geom(h.lng, h.lat)::geography, 600)
      ORDER BY house_geom(n.lng, n.lat) <-> house_geom(h.lng, h.lat) LIMIT wanted) s;
  END IF;
  RETURN coalesce(out, '[]'::jsonb);
END $$;

-- The USPS routes for a thousand flyers: the house's own route first, then
-- the routes nearest the house until the residential pieces reach the
-- number wanted. Whole routes, because EDDM only sells whole routes.
CREATE OR REPLACE FUNCTION public.marketing_flyer_routes(the_house UUID, wanted INTEGER DEFAULT 1000)
RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE h RECORD; r RECORD; total INTEGER := 0; picked JSONB := '[]'::jsonb; pt geometry;
BEGIN
  SELECT * INTO h FROM houses WHERE id = the_house;
  IF h.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  pt := house_geom(h.lng, h.lat);
  FOR r IN
    SELECT e.id, e.zip, e.route_id, e.residential_count, e.business_count, e.total_count,
           coalesce(e.attributes->>'FAC_NAME', e.attributes->>'FACILITY_NAME', e.attributes->>'FACILITY') AS facility,
           (e.id = h.eddm_route_id) AS own,
           ST_Distance(pt::geography, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(jsonb_build_object('type', 'Polygon', 'coordinates', e.rings)::text), 4326))::geography) AS dist
    FROM eddm_routes e
    WHERE e.organization_id = h.organization_id AND coalesce(e.residential_count, 0) > 0
      AND jsonb_typeof(e.rings) = 'array' AND jsonb_array_length(e.rings) > 0
      AND ST_SetSRID(ST_GeomFromGeoJSON(jsonb_build_object('type', 'Polygon', 'coordinates', e.rings)::text), 4326) && ST_Expand(pt, 0.12)
    ORDER BY own DESC, dist ASC
  LOOP
    EXIT WHEN total >= wanted;
    picked := picked || jsonb_build_object('id', r.id, 'zip', r.zip, 'routeId', r.route_id, 'residential', r.residential_count,
      'business', r.business_count, 'total', r.total_count, 'facility', r.facility, 'pieces', r.residential_count);
    total := total + r.residential_count;
  END LOOP;
  RETURN picked;
END $$;

-- Writes the plays that are missing. Safe to run any number of times.
CREATE OR REPLACE FUNCTION public.marketing_sync(org UUID)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE c RECORD; since TIMESTAMPTZ; made INTEGER := 0; hangers_recent BOOLEAN; z UUID; t JSONB;
BEGIN
  SELECT marketing_since INTO since FROM organizations WHERE id = org;
  IF since IS NULL THEN RETURN jsonb_build_object('made', 0); END IF;

  -- Every evaluation, from thirty days before the plays began: hangers
  -- around the house, in its zone.
  FOR c IN
    SELECT DISTINCT ON (h.id) h.id AS house_id, j.id AS job_id, p.customer_id
    FROM jobs j
    JOIN properties p ON p.id = j.property_id
    JOIN customers cu ON cu.id = p.customer_id
    JOIN houses h ON h.property_id = p.id AND h.kind = 'house' AND NOT h.needs_review
    WHERE cu.organization_id = org AND j.status <> 'cancelled'
      AND j.evaluation_status IN ('scheduled', 'on_way', 'arrived', 'completed')
      AND coalesce(j.evaluation_date::timestamptz, j.created_at) >= since - interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM marketing_plays m WHERE m.house_id = h.id AND m.reason = 'evaluation' AND m.kind = 'door_hangers')
    ORDER BY h.id, j.created_at DESC
  LOOP
    SELECT zone_id INTO z FROM zone_houses WHERE house_id = c.house_id LIMIT 1;
    t := marketing_hanger_targets(c.house_id, 100);
    INSERT INTO marketing_plays (organization_id, house_id, job_id, customer_id, reason, kind, quantity, zone_id, targets)
    VALUES (org, c.house_id, c.job_id, c.customer_id, 'evaluation', 'door_hangers', jsonb_array_length(t), z, t)
    ON CONFLICT DO NOTHING;
    made := made + 1;
  END LOOP;

  -- Every new client: paid or billed (the money's own events), or a job
  -- they said yes to. The full set.
  FOR c IN
    SELECT DISTINCT ON (x.house_id) x.house_id, x.job_id, x.customer_id, x.at FROM (
      SELECT h.id AS house_id, e.job_id, e.customer_id, e.occurred_at AS at
      FROM property_events e JOIN houses h ON h.id = e.house_id
      WHERE e.organization_id = org AND e.kind IN ('client', 'job_completed') AND h.kind = 'house' AND NOT h.needs_review
        AND e.occurred_at >= since - interval '30 days'
      UNION ALL
      SELECT h.id, j.id, p.customer_id, j.updated_at
      FROM jobs j
      JOIN properties p ON p.id = j.property_id
      JOIN customers cu ON cu.id = p.customer_id
      JOIN houses h ON h.property_id = p.id AND h.kind = 'house' AND NOT h.needs_review
      WHERE cu.organization_id = org AND j.status IN ('approved', 'in_progress', 'completed')
        AND j.updated_at >= since - interval '30 days'
    ) x
    WHERE NOT EXISTS (SELECT 1 FROM marketing_plays m WHERE m.house_id = x.house_id AND m.reason = 'client')
    ORDER BY x.house_id, x.at DESC
  LOOP
    IF EXISTS (SELECT 1 FROM marketing_plays m WHERE m.house_id = c.house_id AND m.reason = 'client') THEN CONTINUE; END IF;
    SELECT zone_id INTO z FROM zone_houses WHERE house_id = c.house_id LIMIT 1;

    INSERT INTO marketing_plays (organization_id, house_id, job_id, customer_id, reason, kind, quantity, zone_id, targets)
    VALUES (org, c.house_id, c.job_id, c.customer_id, 'client', 'yard_sign', 1, z, jsonb_build_array(c.house_id))
    ON CONFLICT DO NOTHING;

    t := marketing_knock_targets(c.house_id);
    INSERT INTO marketing_plays (organization_id, house_id, job_id, customer_id, reason, kind, quantity, zone_id, targets)
    VALUES (org, c.house_id, c.job_id, c.customer_id, 'client', 'knocks', jsonb_array_length(t), z, t)
    ON CONFLICT DO NOTHING;

    -- The evaluation's hangers, still to go out or out in the last two
    -- months, are this street's hangers; a second hundred would be the
    -- same doors again.
    SELECT EXISTS (SELECT 1 FROM marketing_plays m WHERE m.house_id = c.house_id AND m.kind = 'door_hangers'
                   AND (m.status = 'open' OR m.done_at > now() - interval '60 days')) INTO hangers_recent;
    IF NOT hangers_recent THEN
      t := marketing_hanger_targets(c.house_id, 100);
      INSERT INTO marketing_plays (organization_id, house_id, job_id, customer_id, reason, kind, quantity, zone_id, targets)
      VALUES (org, c.house_id, c.job_id, c.customer_id, 'client', 'door_hangers', jsonb_array_length(t), z, t)
      ON CONFLICT DO NOTHING;
    END IF;

    t := marketing_flyer_routes(c.house_id, 1000);
    INSERT INTO marketing_plays (organization_id, house_id, job_id, customer_id, reason, kind, quantity, zone_id, targets)
    VALUES (org, c.house_id, c.job_id, c.customer_id, 'client', 'flyers',
            coalesce((SELECT sum((p->>'pieces')::integer) FROM jsonb_array_elements(t) p), 0), z, t)
    ON CONFLICT DO NOTHING;
    made := made + 1;
  END LOOP;

  RETURN jsonb_build_object('made', made);
END $$;

-- Ticking a play off. Hangers ticked off are recorded on every door they
-- went to, each with the design that door was due, so the house card and
-- the next print run know. Reopening takes those records back.
CREATE OR REPLACE FUNCTION public.marketing_play_set(the_play UUID, new_status TEXT, by UUID, designs INTEGER DEFAULT 1)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE p RECORD; recorded INTEGER := 0; stamp TIMESTAMPTZ := now();
BEGIN
  SELECT * INTO p FROM marketing_plays WHERE id = the_play;
  IF p.id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  IF new_status NOT IN ('open', 'done', 'skipped') THEN RETURN jsonb_build_object('ok', false); END IF;

  IF p.status = 'done' AND new_status <> 'done' AND p.kind = 'door_hangers' AND p.done_at IS NOT NULL THEN
    DELETE FROM door_hanger_events d
    WHERE d.organization_id = p.organization_id AND d.hung_at = p.done_at
      AND d.house_id IN (SELECT t.value::uuid FROM jsonb_array_elements_text(p.targets) t);
  END IF;

  IF new_status = 'done' AND p.status <> 'done' AND p.kind = 'door_hangers' THEN
    INSERT INTO door_hanger_events (organization_id, house_id, zone_id, design_number, hung_at, hung_by)
    SELECT p.organization_id, t.value::uuid, p.zone_id,
           least(greatest(1, designs), (SELECT count(*) FROM door_hanger_events d WHERE d.house_id = t.value::uuid) + 1),
           stamp, by
    FROM jsonb_array_elements_text(p.targets) t;
    GET DIAGNOSTICS recorded = ROW_COUNT;
  END IF;

  UPDATE marketing_plays SET status = new_status,
    done_at = CASE WHEN new_status = 'done' THEN stamp ELSE NULL END,
    done_by = CASE WHEN new_status = 'done' THEN by ELSE NULL END,
    updated_at = stamp
  WHERE id = the_play;
  RETURN jsonb_build_object('ok', true, 'recorded', recorded);
END $$;

-- The zones the office needs to see: the ones with an evaluation, a
-- client, or a play still to do in them. The rest of the county is there
-- behind a switch.
CREATE OR REPLACE FUNCTION public.zone_is_active(the_zone UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM zone_houses zh JOIN houses h ON h.id = zh.house_id
    WHERE zh.zone_id = the_zone AND (
      EXISTS (SELECT 1 FROM property_events e WHERE e.house_id = h.id AND e.kind IN ('evaluation', 'proposal', 'client', 'job_completed'))
      OR EXISTS (SELECT 1 FROM marketing_plays m WHERE m.house_id = h.id)
      OR (h.property_id IS NOT NULL AND EXISTS (SELECT 1 FROM jobs j WHERE j.property_id = h.property_id AND j.status <> 'cancelled'))));
$$;

CREATE OR REPLACE FUNCTION public.zones_geojson(org UUID)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(jsonb_build_object(
    'type', 'Feature',
    'geometry', z.boundary_geojson,
    'properties', jsonb_build_object(
      'id', z.id, 'name', z.name, 'zip', z.zip, 'mode', z.mode, 'houses', z.house_count,
      'pathKm', z.path_km, 'minutes', z.est_minutes, 'gapM', z.median_gap_m,
      'park', z.park_point, 'start', z.start_point, 'startAddress', z.start_address,
      'routeId', r.route_id, 'walkability', r.walkability, 'reason', r.walkability_reason,
      'waveId', coalesce(z.wave_id, r.wave_id),
      'clients', (SELECT count(*) FROM zone_houses zh JOIN property_events e ON e.house_id = zh.house_id
                  WHERE zh.zone_id = z.id AND e.kind IN ('client', 'job_completed')),
      'active', zone_is_active(z.id),
      'open', (SELECT count(*) FROM marketing_plays m WHERE m.zone_id = z.id AND m.status = 'open'))
  )), '[]'::jsonb))
  FROM hanger_zones z LEFT JOIN eddm_routes r ON r.id = z.eddm_route_id
  WHERE z.organization_id = org AND z.boundary_geojson IS NOT NULL AND z.house_count > 0;
$$;

CREATE OR REPLACE FUNCTION public.zones_list(org UUID)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', z.id, 'name', z.name, 'zip', z.zip, 'mode', z.mode, 'houses', z.house_count,
    'pathKm', z.path_km, 'minutes', z.est_minutes, 'gapM', z.median_gap_m,
    'park', z.park_point, 'start', z.start_point, 'startAddress', z.start_address,
    'routeId', r.route_id, 'walkability', r.walkability, 'reason', r.walkability_reason, 'waveId', coalesce(z.wave_id, r.wave_id),
    'clients', (SELECT count(*) FROM zone_houses zh JOIN property_events e ON e.house_id = zh.house_id
                WHERE zh.zone_id = z.id AND e.kind IN ('client', 'job_completed')),
    'kinds', (SELECT coalesce(jsonb_object_agg(k.kind, k.n), '{}'::jsonb) FROM (
                SELECT hk.kind, count(*) AS n FROM zone_houses zh JOIN house_kinds hk ON hk.house_id = zh.house_id WHERE zh.zone_id = z.id GROUP BY hk.kind) k),
    'active', zone_is_active(z.id),
    'open', (SELECT count(*) FROM marketing_plays m WHERE m.zone_id = z.id AND m.status = 'open'),
    'builtAt', z.built_at
  ) ORDER BY z.zip, z.name), '[]'::jsonb)
  FROM hanger_zones z LEFT JOIN eddm_routes r ON r.id = z.eddm_route_id
  WHERE z.organization_id = org AND z.eddm_route_id IS NOT NULL AND z.house_count > 0;
$$;

-- The plays, with the house, the person and the zone, for the list.
CREATE OR REPLACE FUNCTION public.marketing_plays_list(org UUID, include_done BOOLEAN DEFAULT true)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'houseId', m.house_id, 'address', h.address, 'lat', h.lat, 'lng', h.lng,
    'jobId', m.job_id, 'customerId', m.customer_id, 'customerName', c.name,
    'reason', m.reason, 'kind', m.kind, 'quantity', m.quantity,
    'zoneId', m.zone_id, 'zoneName', z.name, 'zoneMode', z.mode,
    'targets', m.targets, 'status', m.status, 'doneAt', m.done_at, 'doneBy', pr.full_name,
    'mailingId', m.mailing_id, 'createdAt', m.created_at,
    'targetAddresses', CASE WHEN m.kind IN ('knocks', 'yard_sign') THEN
      (SELECT jsonb_agg(t.address ORDER BY t.ord) FROM (
         SELECT th.address, o.ord FROM jsonb_array_elements_text(m.targets) WITH ORDINALITY o(id, ord)
         JOIN houses th ON th.id = (o.id)::uuid) t) ELSE NULL END
  ) ORDER BY (m.status = 'open') DESC, m.created_at DESC, m.kind), '[]'::jsonb)
  FROM marketing_plays m
  JOIN houses h ON h.id = m.house_id
  LEFT JOIN customers c ON c.id = m.customer_id
  LEFT JOIN hanger_zones z ON z.id = m.zone_id
  LEFT JOIN profiles pr ON pr.id = m.done_by
  WHERE m.organization_id = org AND (include_done OR m.status = 'open');
$$;

-- Every five minutes, so a client who paid at lunch has their plays by
-- the time somebody looks. The page also syncs when it opens.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketing-sync') THEN
      PERFORM cron.unschedule('marketing-sync');
    END IF;
    PERFORM cron.schedule('marketing-sync', '*/5 * * * *', 'SELECT public.marketing_sync(id) FROM public.organizations');
  END IF;
END $$;

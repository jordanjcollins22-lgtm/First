-- Every row belongs to one business, and only that business can reach it.
--
-- The pulse, the targets, the ramp and the bank were shut in 0193. This is
-- the rest of it: the houses, the zones, the routes, the marketing and the
-- events every metric is counted from. All of it carried an
-- organization_id and none of it had row security, so a signed-in person
-- at one business could read another's county of addresses, owners'
-- names, zones, marketing and history straight through the API. There are
-- two businesses on this database, so that was real rather than
-- theoretical.
--
-- Now: row security on all of it, with one policy each -- your own
-- business, for reading and for writing alike. The write half matters as
-- much as the read half, because the functions that build zones and make
-- marketing take the business as an argument, and the check is what stops
-- an argument being swapped for somebody else's.
--
-- The two tables that carry no organisation of their own are scoped
-- through the house they hang off.
--
-- The service role has no policies and needs none: it bypasses row
-- security, which is how the crons, the county import and the background
-- jobs go on seeing everything.
--
-- Speed: the heavy county-wide answers (the map's points take seven
-- seconds, the zone list four) are computed inside summary_compute, which
-- now runs as its owner. So they are worked out once, without a row check
-- on any of the hundred and seventeen thousand houses, and are handed to
-- whoever asks for their own business's copy -- guarded at the door by
-- summary_get and summary_refresh, which already check the caller owns
-- what they are asking for. That also means a kept answer no longer
-- depends on which roles the person who happened to trigger it holds,
-- which is exactly the fault that made the overhead read as nothing.

CREATE OR REPLACE FUNCTION public.summary_compute(org UUID, the_key TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN CASE the_key
    WHEN 'ownership_summary' THEN ownership_summary(org)
    WHEN 'relationship_ownership_matrix' THEN relationship_ownership_matrix(org)
    WHEN 'kind_summary' THEN kind_summary(org)
    WHEN 'zones_list' THEN zones_list(org)
    WHEN 'zones_geojson' THEN zones_geojson(org)
    WHEN 'eddm_unserved_cells' THEN eddm_unserved_cells(org)
    WHEN 'houses_map_points' THEN houses_map_points(org)
    WHEN 'houses_unserved_points' THEN houses_unserved_points(org)
    WHEN 'ops_pulse' THEN ops_pulse(org)
    ELSE NULL
  END;
END $$;

-- Everything that names its own business.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'houses', 'house_kinds', 'house_match_reviews', 'house_ownership', 'property_events',
    'hanger_zones', 'hanger_routes', 'zone_reviews',
    'eddm_routes', 'eddm_segments', 'eddm_mailings', 'door_hanger_events',
    'marketing_plays', 'marketing_play_reviews', 'marketing_defaults',
    'gis_import_jobs', 'gis_import_settings']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_own_org', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id())',
      t || '_own_org', t);
  END LOOP;
END $$;

-- The two that hang off a house rather than naming a business.
ALTER TABLE public.zone_houses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS zone_houses_own_org ON public.zone_houses;
CREATE POLICY zone_houses_own_org ON public.zone_houses FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM houses h WHERE h.id = zone_houses.house_id AND h.organization_id = current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM houses h WHERE h.id = zone_houses.house_id AND h.organization_id = current_org_id()));

ALTER TABLE public.house_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_contacts_own_org ON public.house_contacts;
CREATE POLICY house_contacts_own_org ON public.house_contacts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM houses h WHERE h.id = house_contacts.house_id AND h.organization_id = current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM houses h WHERE h.id = house_contacts.house_id AND h.organization_id = current_org_id()));

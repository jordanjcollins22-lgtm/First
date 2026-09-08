-- The weed guide: one list, two sheets, a code on every row.
--
-- A crew needs sixty-three weeds with their scientific names; a client needs
-- the twenty-seven they can point at. Both are the same list, so a weed is
-- never described two ways depending on who is holding the paper.
--
-- Paper can hold one photograph and cannot swap it, so each weed has one
-- print photo, uploaded by hand -- a stock photo of crabgrass is as often a
-- picture of a lawn, and nobody finds that out until three hundred sheets
-- are printed. Every other photo stays for the screen, where they can be
-- flicked through. The printed row carries a QR of the weed's own code, so
-- scanning it opens that weed with all its photos.
--
-- prep is the note that belongs with the weed -- what to do before treating
-- it. The prep and install checklists will read the same field rather than
-- keeping a second copy of it.
--
-- The list itself is not repeated here. It lives in src/lib/weeds.ts, which
-- is where the sheets read it from, and weeds_install is handed it: one copy
-- of sixty-three plants, not two that drift apart.

CREATE TABLE IF NOT EXISTS public.weeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  common_name TEXT NOT NULL,
  scientific_name TEXT NOT NULL,
  weed_group TEXT NOT NULL,
  on_client_sheet BOOLEAN NOT NULL DEFAULT false,
  -- Six characters of the stock-label alphabet: no O/0, no I/1/L, no U.
  code TEXT NOT NULL,
  print_photo_id UUID,
  prep TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug),
  UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS weeds_org_idx ON public.weeds (organization_id, position);

CREATE TABLE IF NOT EXISTS public.weed_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  weed_id UUID NOT NULL REFERENCES public.weeds(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  caption TEXT,
  credit TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS weed_photos_weed_idx ON public.weed_photos (weed_id, position);

DO $do$ BEGIN
  ALTER TABLE public.weeds
    ADD CONSTRAINT weeds_print_photo_fkey FOREIGN KEY (print_photo_id)
    REFERENCES public.weed_photos(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

ALTER TABLE public.weeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weed_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS weeds_own_org ON public.weeds;
CREATE POLICY weeds_own_org ON public.weeds FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
DROP POLICY IF EXISTS weed_photos_own_org ON public.weed_photos;
CREATE POLICY weed_photos_own_org ON public.weed_photos FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- The photos are shown on the page a client scans, which has no login.
INSERT INTO storage.buckets (id, name, public) VALUES ('weed-photos', 'weed-photos', true)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS read_weed_photos ON storage.objects;
CREATE POLICY read_weed_photos ON storage.objects FOR SELECT TO public USING (bucket_id = 'weed-photos');
DROP POLICY IF EXISTS write_weed_photos ON storage.objects;
CREATE POLICY write_weed_photos ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'weed-photos');
DROP POLICY IF EXISTS update_weed_photos ON storage.objects;
CREATE POLICY update_weed_photos ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'weed-photos');
DROP POLICY IF EXISTS delete_weed_photos ON storage.objects;
CREATE POLICY delete_weed_photos ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'weed-photos');

-- A code that cannot be misread or misheard: no O/0, no I/1/L, no U, and
-- drawn again if the business already has that one.
CREATE OR REPLACE FUNCTION public.weed_code(org UUID)
RETURNS TEXT LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE alphabet TEXT := '23456789ABCDEFGHJKMNPQRSTVWXYZ'; c TEXT; i INTEGER; tries INTEGER := 0;
BEGIN
  LOOP
    c := '';
    FOR i IN 1..6 LOOP c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM weeds w WHERE w.organization_id = org AND w.code = c);
    tries := tries + 1;
    IF tries > 50 THEN RAISE EXCEPTION 'Could not find a free weed code.'; END IF;
  END LOOP;
  RETURN c;
END $fn$;
REVOKE ALL ON FUNCTION public.weed_code(UUID) FROM PUBLIC, anon;

-- The guide as it ships, handed in from the app. Run again after a weed is
-- added to the list; it never touches a row somebody has already edited.
CREATE OR REPLACE FUNCTION public.weeds_install(org UUID, rows JSONB)
RETURNS INTEGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE n INTEGER;
BEGIN
  PERFORM assert_own_org(org);
  INSERT INTO weeds (organization_id, slug, common_name, scientific_name, weed_group, on_client_sheet, code, position)
  SELECT org, s.slug, s.common, s.scientific, s.grp, s.client, weed_code(org), s.pos
  FROM jsonb_to_recordset(rows) AS s(slug TEXT, common TEXT, scientific TEXT, grp TEXT, client BOOLEAN, pos INTEGER)
  WHERE s.slug IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM weeds w WHERE w.organization_id = org AND w.slug = s.slug);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION public.weeds_install(UUID, JSONB) FROM PUBLIC, anon;

-- One weed for the page a QR opens. No login: whoever scanned it is holding
-- the sheet, and there is nothing on the page but a plant.
CREATE OR REPLACE FUNCTION public.weed_by_code(the_code TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT jsonb_build_object(
    'id', w.id, 'slug', w.slug, 'common', w.common_name, 'scientific', w.scientific_name,
    'group', w.weed_group, 'code', w.code, 'prep', w.prep,
    'printPhotoId', w.print_photo_id,
    'photos', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'path', p.path, 'caption', p.caption, 'credit', p.credit, 'position', p.position)
                       ORDER BY (p.id = w.print_photo_id) DESC, p.position, p.created_at)
      FROM weed_photos p WHERE p.weed_id = w.id), '[]'::jsonb))
  FROM weeds w WHERE upper(w.code) = upper(the_code) LIMIT 1;
$fn$;
GRANT EXECUTE ON FUNCTION public.weed_by_code(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- The app puts the guide in on the first look, as whoever opened it, so the
-- two functions it needs must be callable with a login. Both check the
-- business first: weeds_install through assert_own_org, weed_code through
-- the rows it is asked about.
GRANT EXECUTE ON FUNCTION public.weeds_install(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.weed_code(UUID) TO authenticated;

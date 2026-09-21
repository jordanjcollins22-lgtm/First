-- A walk has an area, parking, a start and an end.
--
-- The line alone caught only the doors within a stone's throw of it, the
-- outer ring of a neighbourhood. A round is the doors inside an area. And a
-- crew needs to know where to leave the van, where to begin and where to
-- finish; more than one parking spot on a big round. All of it is drawn by
-- hand and kept on the play, and the walking line is kept as well, so the
-- order the doors were walked in is the order they are shown in next time.
ALTER TABLE public.marketing_plays
  ADD COLUMN IF NOT EXISTS walk_area JSONB,
  ADD COLUMN IF NOT EXISTS park_points JSONB,
  ADD COLUMN IF NOT EXISTS start_point JSONB,
  ADD COLUMN IF NOT EXISTS end_point JSONB;

-- One signature, or a six-argument call would be ambiguous.
DROP FUNCTION IF EXISTS public.marketing_play_set_doors(UUID, UUID, UUID[], JSONB, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.marketing_play_set_doors(
  org UUID, the_play UUID, doors UUID[], line JSONB DEFAULT NULL, note TEXT DEFAULT NULL, by UUID DEFAULT NULL,
  area JSONB DEFAULT NULL, parks JSONB DEFAULT NULL, start_pt JSONB DEFAULT NULL, end_pt JSONB DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE p RECORD; kept UUID[]; before INTEGER; after INTEGER; gone UUID[]; came INTEGER;
BEGIN
  PERFORM assert_own_org(org);
  SELECT * INTO p FROM marketing_plays WHERE id = the_play AND organization_id = org;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'That round is not there.'); END IF;
  IF p.kind <> 'door_hangers' THEN RETURN jsonb_build_object('ok', false, 'error', 'Only a door hanger round is drawn.'); END IF;
  IF doors IS NULL OR array_length(doors, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'The drawing reaches no doors.');
  END IF;

  SELECT array_agg(id ORDER BY ord) INTO kept
  FROM (
    SELECT DISTINCT ON (a.id) a.id, a.ord
    FROM unnest(doors) WITH ORDINALITY a(id, ord)
    JOIN houses h ON h.id = a.id AND h.lat IS NOT NULL AND h.lng IS NOT NULL
    ORDER BY a.id, a.ord
  ) u;
  IF kept IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'None of those doors are on the map.'); END IF;

  before := jsonb_array_length(p.targets);
  after := array_length(kept, 1);
  SELECT coalesce(array_agg(t.value::uuid), '{}'::uuid[]) INTO gone
  FROM jsonb_array_elements_text(p.targets) t WHERE NOT (t.value::uuid = ANY (kept));
  came := (SELECT count(*) FROM unnest(kept) k WHERE NOT (p.targets ? k::text));

  UPDATE marketing_plays
  SET targets = to_jsonb(kept),
      quantity = after,
      removed = coalesce((SELECT jsonb_agg(r) FROM jsonb_array_elements(coalesce(removed, '[]'::jsonb)) r
                          WHERE NOT ((r #>> '{}')::uuid = ANY (kept))), '[]'::jsonb) || to_jsonb(gone),
      walk_order = to_jsonb(kept),
      walk_order_line = line,
      walk_area = area,
      park_points = coalesce(parks, '[]'::jsonb),
      start_point = start_pt,
      end_point = end_pt,
      walk_order_set_at = now(),
      walk_order_set_by = by,
      approval = 'pending', approved_at = NULL, approved_by = NULL,
      updated_at = now()
  WHERE id = the_play;

  INSERT INTO marketing_play_reviews (organization_id, play_id, kind, reason, decision, quantity_before, quantity_after, removed_count, note, reviewer)
  VALUES (org, the_play, p.kind, p.reason, 'edit', before, after, coalesce(array_length(gone, 1), 0),
          coalesce(note, format('Drawn: %s doors, %s added, %s taken off', after, came, coalesce(array_length(gone, 1), 0))), by);

  RETURN jsonb_build_object('ok', true, 'quantity', after, 'added', came, 'removed', coalesce(array_length(gone, 1), 0));
END $$;

NOTIFY pgrst, 'reload schema';

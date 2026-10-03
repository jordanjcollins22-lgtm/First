-- Saving a drawn round is one step, and a fast one.
--
-- The route wizard saved a drawn round as three calls: add the doors the
-- line reached, take off the ones it did not, then set the order. The
-- middle one timed out: the review it writes measured every door's
-- distance from the house with PostGIS geography, about six milliseconds
-- a door, twice over, and the save died with the doors added and the
-- line lost. So a drawn round is now written in one call that sets the
-- doors to exactly what was drawn, in that order, with the line, and the
-- review keeps its distances with plain arithmetic, which is all a
-- neighbourhood needs.

-- Metres between two points, near enough for a street. No PostGIS.
CREATE OR REPLACE FUNCTION public.flat_metres(lat1 NUMERIC, lng1 NUMERIC, lat2 NUMERIC, lng2 NUMERIC)
RETURNS DOUBLE PRECISION LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT sqrt(
    ((lat1 - lat2)::double precision * 111320) ^ 2 +
    ((lng1 - lng2)::double precision * 111320 * cos(radians(lat1::double precision))) ^ 2);
$$;

CREATE OR REPLACE FUNCTION public.marketing_play_set_doors(org UUID, the_play UUID, doors UUID[], line JSONB DEFAULT NULL, note TEXT DEFAULT NULL, by UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE p RECORD; kept UUID[]; before INTEGER; after INTEGER; gone UUID[]; came INTEGER;
BEGIN
  PERFORM assert_own_org(org);
  SELECT * INTO p FROM marketing_plays WHERE id = the_play AND organization_id = org;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'That round is not there.'); END IF;
  IF p.kind <> 'door_hangers' THEN RETURN jsonb_build_object('ok', false, 'error', 'Only a door hanger round is drawn.'); END IF;
  IF doors IS NULL OR array_length(doors, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'The line reaches no doors.');
  END IF;

  -- Real houses only, in the order given, each once.
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
      walk_order_set_at = now(),
      walk_order_set_by = by,
      approval = 'pending', approved_at = NULL, approved_by = NULL,
      updated_at = now()
  WHERE id = the_play;

  INSERT INTO marketing_play_reviews (organization_id, play_id, kind, reason, decision, quantity_before, quantity_after, removed_count, note, reviewer)
  VALUES (org, the_play, p.kind, p.reason, 'edit', before, after, coalesce(array_length(gone, 1), 0),
          coalesce(note, format('Drawn: %s doors on the line, %s added, %s taken off', after, came, coalesce(array_length(gone, 1), 0))), by);

  RETURN jsonb_build_object('ok', true, 'quantity', after, 'added', came, 'removed', coalesce(array_length(gone, 1), 0));
END $$;

-- The review, with its distances done by arithmetic.
CREATE OR REPLACE FUNCTION public.marketing_play_review(org UUID, the_play UUID, decision TEXT, remove UUID[] DEFAULT NULL, set_quantity INTEGER DEFAULT NULL, note TEXT DEFAULT NULL, by UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE p RECORD; before INTEGER; after INTEGER; new_targets JSONB; new_removed JSONB; kept_max DOUBLE PRECISION; removed_min DOUBLE PRECISION; n_removed INTEGER := 0; hlat NUMERIC; hlng NUMERIC;
BEGIN
  SELECT * INTO p FROM marketing_plays WHERE id = the_play AND organization_id = org;
  IF p.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'No such play.'); END IF;
  IF decision NOT IN ('approve', 'auto', 'edit') THEN RETURN jsonb_build_object('ok', false, 'error', 'Not a decision.'); END IF;
  before := p.quantity; after := p.quantity; new_targets := p.targets; new_removed := p.removed;
  SELECT h.lat, h.lng INTO hlat, hlng FROM houses h WHERE h.id = p.house_id;

  IF decision = 'edit' THEN
    IF remove IS NOT NULL AND array_length(remove, 1) > 0 THEN
      IF p.kind = 'flyers' THEN
        SELECT coalesce(jsonb_agg(r), '[]'::jsonb) INTO new_targets FROM jsonb_array_elements(p.targets) r WHERE NOT ((r->>'id')::uuid = ANY (remove));
        n_removed := jsonb_array_length(p.targets) - jsonb_array_length(new_targets);
      ELSE
        SELECT coalesce(jsonb_agg(t.value), '[]'::jsonb) INTO new_targets FROM jsonb_array_elements_text(p.targets) t WHERE NOT (t.value::uuid = ANY (remove));
        n_removed := jsonb_array_length(p.targets) - jsonb_array_length(new_targets);
        SELECT min(flat_metres(h.lat, h.lng, hlat, hlng)) INTO removed_min FROM houses h WHERE h.id = ANY (remove);
      END IF;
      new_removed := new_removed || to_jsonb(remove);
    END IF;
    IF set_quantity IS NOT NULL AND p.kind = 'door_hangers' AND set_quantity <> jsonb_array_length(new_targets) THEN
      new_targets := marketing_hanger_targets(p.house_id, set_quantity, marketing_default_reach(org, 'door_hangers'),
        coalesce((SELECT array_agg(v::uuid) FROM jsonb_array_elements_text(new_removed) v), '{}'::uuid[]));
    ELSIF set_quantity IS NOT NULL AND p.kind = 'knocks' AND set_quantity < jsonb_array_length(new_targets) THEN
      SELECT coalesce(jsonb_agg(t.value ORDER BY t.ord), '[]'::jsonb) INTO new_targets FROM jsonb_array_elements_text(new_targets) WITH ORDINALITY t(value, ord) WHERE t.ord <= set_quantity;
    END IF;
    after := CASE WHEN p.kind = 'flyers' THEN coalesce((SELECT sum((r->>'pieces')::integer) FROM jsonb_array_elements(new_targets) r), 0) ELSE jsonb_array_length(new_targets) END;
    IF p.kind <> 'flyers' THEN
      SELECT max(flat_metres(h.lat, h.lng, hlat, hlng)) INTO kept_max
      FROM jsonb_array_elements_text(new_targets) t JOIN houses h ON h.id = t.value::uuid;
    END IF;
    UPDATE marketing_plays SET targets = new_targets, quantity = after, removed = new_removed, approval = 'pending', approved_at = NULL, approved_by = NULL, updated_at = now()
    WHERE id = p.id;
  ELSE
    IF p.kind <> 'flyers' THEN
      SELECT max(flat_metres(h.lat, h.lng, hlat, hlng)) INTO kept_max
      FROM jsonb_array_elements_text(p.targets) t JOIN houses h ON h.id = t.value::uuid;
    END IF;
    UPDATE marketing_plays SET approval = decision, approved_at = now(), approved_by = by, updated_at = now() WHERE id = p.id;
  END IF;

  INSERT INTO marketing_play_reviews (organization_id, play_id, kind, reason, decision, quantity_before, quantity_after, removed_count, kept_max_m, removed_min_m, note, reviewer)
  VALUES (org, p.id, p.kind, p.reason, decision, before, after, n_removed, kept_max, removed_min, note, by);
  RETURN jsonb_build_object('ok', true, 'quantity', after, 'removed', n_removed);
END $$;

NOTIFY pgrst, 'reload schema';

-- The client marketing set waits for the money.
--
-- The yard sign, the knocks, the hangers and the flyers by mail went out
-- the moment a job was approved. They now wait until the job is finished
-- and paid in full, the same rule the route wizard on My Day uses, so a
-- neighbourhood only hears from us about work that happened and was paid
-- for.

-- Paid in full, the way the app counts it: the proposal says the app took
-- the money, or what came in covers the accepted price after the discount.
-- Payments count net of the card fee. A paid invoice that no payment points
-- at (by our id or Stripe's) counts only beyond what the job's untied
-- payments already cover, so a check recorded on the job and the invoice
-- ticked paid later are one sum, not two. A job with no accepted price
-- counts only when something was paid.
CREATE OR REPLACE FUNCTION public.job_paid_in_full(the_job UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $$
  WITH proposal AS (
    SELECT total_cost, discount_amount, paid_at
    FROM job_proposals
    WHERE job_id = the_job AND status IN ('accepted', 'paid')
    ORDER BY responded_at DESC NULLS LAST
    LIMIT 1
  ),
  pays AS (
    SELECT coalesce(sum(amount_cents - coalesce(surcharge_cents, 0)), 0)::bigint AS net,
           coalesce(sum(amount_cents - coalesce(surcharge_cents, 0)) FILTER (WHERE invoice_id IS NULL AND stripe_invoice_id IS NULL), 0)::bigint AS untied
    FROM payments WHERE job_id = the_job
  ),
  ledger AS (
    SELECT coalesce(sum(round(amount * 100)), 0)::bigint AS cents
    FROM ledger_entries WHERE job_id = the_job AND direction = 'in'
  ),
  unpointed AS (
    SELECT coalesce(sum(round(i.amount * 100)), 0)::bigint AS cents
    FROM invoices i
    WHERE i.job_id = the_job AND (i.paid_at IS NOT NULL OR i.status = 'paid')
      AND NOT EXISTS (
        SELECT 1 FROM payments p
        WHERE p.invoice_id = i.id OR (i.stripe_invoice_id IS NOT NULL AND p.stripe_invoice_id = i.stripe_invoice_id)
      )
  )
  SELECT coalesce(
    (SELECT paid_at IS NOT NULL FROM proposal), false)
    OR (
      (SELECT net FROM pays) + (SELECT cents FROM ledger) + greatest(0, (SELECT cents FROM unpointed) - (SELECT untied FROM pays))
      >= greatest(coalesce((SELECT round((total_cost - coalesce(discount_amount, 0)) * 100) FROM proposal), 1), 1)
    );
$$;

CREATE OR REPLACE FUNCTION public.marketing_sync(org UUID)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE c RECORD; since TIMESTAMPTZ; made INTEGER := 0; hangers_recent BOOLEAN; z UUID; t JSONB;
  q_hangers INTEGER; reach DOUBLE PRECISION; q_flyers INTEGER;
BEGIN
  SELECT marketing_since INTO since FROM organizations WHERE id = org;
  IF since IS NULL THEN RETURN jsonb_build_object('made', 0); END IF;
  q_hangers := marketing_default_quantity(org, 'door_hangers', 100);
  reach := marketing_default_reach(org, 'door_hangers');
  q_flyers := marketing_default_quantity(org, 'flyers', 1000);

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
    t := marketing_hanger_targets(c.house_id, q_hangers, reach);
    INSERT INTO marketing_plays (organization_id, house_id, job_id, customer_id, reason, kind, quantity, zone_id, targets)
    VALUES (org, c.house_id, c.job_id, c.customer_id, 'evaluation', 'door_hangers', jsonb_array_length(t), z, t)
    ON CONFLICT DO NOTHING;
    made := made + 1;
  END LOOP;

  -- The client set goes out round a job that is finished and paid for:
  -- the neighbours watched the work, and nothing is owed on it.
  FOR c IN
    SELECT DISTINCT ON (x.house_id) x.house_id, x.job_id, x.customer_id, x.at FROM (
      SELECT h.id AS house_id, j.id AS job_id, p.customer_id, coalesce(j.completed_at, j.updated_at) AS at
      FROM jobs j
      JOIN properties p ON p.id = j.property_id
      JOIN customers cu ON cu.id = p.customer_id
      JOIN houses h ON h.property_id = p.id AND h.kind = 'house' AND NOT h.needs_review
      WHERE cu.organization_id = org AND j.status = 'completed' AND j.cancelled_at IS NULL
        AND coalesce(j.completed_at, j.updated_at) >= since - interval '30 days'
        AND job_paid_in_full(j.id)
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

    SELECT EXISTS (SELECT 1 FROM marketing_plays m WHERE m.house_id = c.house_id AND m.kind = 'door_hangers'
                   AND (m.status = 'open' OR m.done_at > now() - interval '60 days')) INTO hangers_recent;
    IF NOT hangers_recent THEN
      t := marketing_hanger_targets(c.house_id, q_hangers, reach);
      INSERT INTO marketing_plays (organization_id, house_id, job_id, customer_id, reason, kind, quantity, zone_id, targets)
      VALUES (org, c.house_id, c.job_id, c.customer_id, 'client', 'door_hangers', jsonb_array_length(t), z, t)
      ON CONFLICT DO NOTHING;
    END IF;

    t := marketing_flyer_routes(c.house_id, q_flyers);
    INSERT INTO marketing_plays (organization_id, house_id, job_id, customer_id, reason, kind, quantity, zone_id, targets)
    VALUES (org, c.house_id, c.job_id, c.customer_id, 'client', 'flyers',
            coalesce((SELECT sum((p->>'pieces')::integer) FROM jsonb_array_elements(t) p), 0), z, t)
    ON CONFLICT DO NOTHING;
    made := made + 1;
  END LOOP;

  RETURN jsonb_build_object('made', made);
END $$;

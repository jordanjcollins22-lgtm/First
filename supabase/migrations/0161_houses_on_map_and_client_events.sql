-- Putting every house on the Project Data map, and calling clients clients.
--
-- Two things. First, the map needs houses by viewport: a hundred and
-- seventeen thousand points cannot ride along with a page, so the map asks
-- for the ones inside its current view, and only when zoomed in enough for
-- them to mean anything. Second, an invoice is what makes a client: the
-- backfill derived "client" only from proposals marked paid, and the invoices
-- brought over from the old system -- plus every payment recorded since --
-- were not counted. They are now, and triggers keep it that way.

CREATE INDEX IF NOT EXISTS houses_lat_lng_idx ON houses (lat, lng);

-- The houses in a viewport, and whether anything has happened to each.
CREATE OR REPLACE FUNCTION houses_in_bbox(
  org UUID, min_lat DOUBLE PRECISION, min_lng DOUBLE PRECISION,
  max_lat DOUBLE PRECISION, max_lng DOUBLE PRECISION, max_rows INTEGER DEFAULT 8000
)
RETURNS TABLE (id UUID, address TEXT, lat DOUBLE PRECISION, lng DOUBLE PRECISION, untouched BOOLEAN)
LANGUAGE sql
STABLE
AS $$
  SELECT h.id, h.address, h.lat::double precision, h.lng::double precision,
         (NOT EXISTS (SELECT 1 FROM property_events e WHERE e.house_id = h.id)
          AND NOT EXISTS (SELECT 1 FROM house_contacts c WHERE c.house_id = h.id)) AS untouched
  FROM houses h
  WHERE h.organization_id = org
    AND h.kind = 'house' AND NOT h.needs_review
    AND h.lat BETWEEN min_lat AND max_lat
    AND h.lng BETWEEN min_lng AND max_lng
    AND NOT (h.lat = 0 AND h.lng = 0)
  LIMIT max_rows;
$$;

-- An invoice from the old system names a customer, not a property, so every
-- house that customer is attached to becomes a client house. The note is the
-- source row, which is what makes re-running this a no-op.
CREATE OR REPLACE FUNCTION record_client_events_for_client_invoice(inv client_invoices)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO property_events (organization_id, house_id, kind, occurred_at, customer_id, amount_cents, note)
  SELECT inv.organization_id, hc.house_id, 'client',
         coalesce(inv.paid_on::timestamptz, inv.issued_on::timestamptz, inv.created_at),
         inv.customer_id, round(coalesce(inv.amount, 0) * 100)::int, 'client_invoice:' || inv.id
  FROM house_contacts hc
  WHERE hc.customer_id = inv.customer_id
    AND NOT EXISTS (SELECT 1 FROM property_events e WHERE e.house_id = hc.house_id AND e.note = 'client_invoice:' || inv.id);
$$;

-- A payment with a job lands on that job's house; one without lands on the
-- customer's houses.
CREATE OR REPLACE FUNCTION record_client_events_for_payment(p payments)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO property_events (organization_id, house_id, kind, occurred_at, job_id, customer_id, amount_cents, note)
  SELECT DISTINCT p.organization_id, t.house_id, 'client', p.received_at, p.job_id, p.customer_id, p.amount_cents, 'payment:' || p.id
  FROM (
    SELECT jh.house_id FROM job_house jh WHERE p.job_id IS NOT NULL AND jh.job_id = p.job_id
    UNION
    SELECT hc.house_id FROM house_contacts hc WHERE p.job_id IS NULL AND p.customer_id IS NOT NULL AND hc.customer_id = p.customer_id
  ) t
  WHERE NOT EXISTS (SELECT 1 FROM property_events e WHERE e.house_id = t.house_id AND e.note = 'payment:' || p.id);
$$;

CREATE OR REPLACE FUNCTION record_client_events_for_invoice(inv invoices)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO property_events (organization_id, house_id, kind, occurred_at, job_id, amount_cents, note)
  SELECT inv.organization_id, jh.house_id, 'client', inv.paid_at, inv.job_id, round(inv.amount * 100)::int, 'invoice:' || inv.id
  FROM job_house jh
  WHERE inv.paid_at IS NOT NULL AND jh.job_id = inv.job_id
    AND NOT EXISTS (SELECT 1 FROM property_events e WHERE e.house_id = jh.house_id AND e.note = 'invoice:' || inv.id);
$$;

CREATE OR REPLACE FUNCTION trg_client_invoice_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM record_client_events_for_client_invoice(NEW); RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION trg_payment_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM record_client_events_for_payment(NEW); RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION trg_invoice_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM record_client_events_for_invoice(NEW); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS client_invoice_client_event ON client_invoices;
CREATE TRIGGER client_invoice_client_event AFTER INSERT OR UPDATE ON client_invoices
  FOR EACH ROW EXECUTE FUNCTION trg_client_invoice_event();
DROP TRIGGER IF EXISTS payment_client_event ON payments;
CREATE TRIGGER payment_client_event AFTER INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_payment_event();
DROP TRIGGER IF EXISTS invoice_client_event ON invoices;
CREATE TRIGGER invoice_client_event AFTER INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION trg_invoice_event();

-- What already happened.
SELECT record_client_events_for_client_invoice(ci) FROM client_invoices ci;
SELECT record_client_events_for_payment(p) FROM payments p;
SELECT record_client_events_for_invoice(i) FROM invoices i;

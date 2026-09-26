/**
 * The same payment arriving twice by two different routes.
 *
 * A payment can already be in the table before an import ever runs. The card
 * processor's webhook records one live, keyed on the processor's own charge
 * id — that is what the unique index on `stripe_payment_intent_id` is for, so
 * a webhook delivered twice records one payment. Months later the same charge
 * comes round again in an export, this time carrying the exporting system's
 * transaction id.
 *
 * The import upserts on (organization_id, external_id). The row already in the
 * table has no external_id, so nothing matches, so the upsert inserts — and
 * hits the charge id already sitting there. Because the rows go in batches,
 * that one collision fails every payment in the batch.
 *
 * They are one payment. The answer is to recognise it and update the row that
 * exists rather than trying to add a second, which would double the money
 * anyway if the unique index were not there to stop it.
 */

export type ChargeKeyed = {
  stripe_payment_intent_id?: string | null;
};

/**
 * Within one file, only the first row may claim a charge id.
 *
 * An export should not mention the same charge twice, but a unique index does
 * not care what should happen, and a repeat inside a single batch fails the
 * whole batch. The later rows keep everything else and give up only the id, so
 * the money is still recorded — it simply is not claiming to be the charge the
 * first row already is.
 */
export function dropRepeatChargeIds<T extends ChargeKeyed>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const id = row.stripe_payment_intent_id;
    if (!id) return row;
    if (seen.has(id)) return { ...row, stripe_payment_intent_id: null };
    seen.add(id);
    return row;
  });
}

/**
 * Split incoming payments into the ones that are already in the table under a
 * charge id, and the ones that are new.
 *
 * `existing` maps a charge id to the id of the payment row already holding it.
 */
export function splitByExistingCharge<T extends ChargeKeyed>(
  rows: T[],
  existing: Map<string, string>
): { updates: (T & { id: string })[]; inserts: T[] } {
  const updates: (T & { id: string })[] = [];
  const inserts: T[] = [];

  for (const row of rows) {
    const chargeId = row.stripe_payment_intent_id;
    const found = chargeId ? existing.get(chargeId) : undefined;
    if (found) updates.push({ ...row, id: found });
    else inserts.push(row);
  }

  return { updates, inserts };
}

/** Every charge id an incoming batch mentions, to look up in one go. */
export function chargeIdsIn(rows: ChargeKeyed[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.stripe_payment_intent_id) ids.add(row.stripe_payment_intent_id);
  }
  return [...ids];
}

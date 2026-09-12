/**
 * How much of the money taken for a job is still the business's.
 *
 * A receipt is not a permanent fact. Money comes in and then goes back out
 * again: a refund, a chargeback the bank takes without asking, a card
 * reversal, a payment voided before it settled. A deposit check that reads the
 * receipts alone goes on saying "paid" for a job whose money left three weeks
 * ago, and a crew is sent out on it.
 *
 * So the receipt is never edited and never deleted -- the money really was
 * taken on the day, and that is part of the job's history -- and what left is
 * written beside it as its own record. The number the readiness engine uses is
 * the difference: net valid money applied to this job.
 *
 * Adjustments rather than a status on the payment, because a status cannot
 * hold a partial refund. Two hundred dollars back off an eight hundred dollar
 * deposit is not a state of the receipt, it is an amount, and the only honest
 * way to hold an amount is to write it down.
 *
 * Where processor synchronisation plugs in: a Stripe `charge.refunded`,
 * `charge.dispute.created` or `payment_intent.canceled` webhook becomes one
 * row here, with the processor's own id in `external_id` -- which is unique,
 * so the same webhook delivered twice cannot take the money off twice. The
 * webhook route is the only piece not yet built; the accounting it would feed
 * is here and is what the gates already read.
 */

export const ADJUSTMENT_KINDS = ["refund", "chargeback", "reversal", "void", "correction"] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export const ADJUSTMENT_LABEL: Record<AdjustmentKind, string> = {
  refund: "Refunded",
  chargeback: "Charged back",
  reversal: "Reversed",
  void: "Voided",
  correction: "Corrected",
};

export function isAdjustmentKind(value: string): value is AdjustmentKind {
  return (ADJUSTMENT_KINDS as readonly string[]).includes(value);
}

export interface Receipt {
  id: string;
  jobId: string | null;
  amountCents: number;
  /** Null where the money was never actually taken, so it counts for nothing. */
  receivedAt: string | null;
}

export interface Adjustment {
  paymentId: string;
  kind: AdjustmentKind;
  amountCents: number;
}

/**
 * What one receipt is still worth.
 *
 * Never below zero: adjustments totalling more than the receipt is a bookkeeping
 * mistake, and the answer to it is that the receipt is worth nothing, not that
 * the job owes the business money it never had.
 */
export function netOfReceipt(receipt: Receipt, adjustments: readonly Adjustment[]): number {
  if (receipt.receivedAt == null) return 0;
  const taken = adjustments
    .filter((adjustment) => adjustment.paymentId === receipt.id)
    .reduce((sum, adjustment) => sum + adjustment.amountCents, 0);
  return Math.max(0, receipt.amountCents - taken);
}

/**
 * Net valid money applied to one job.
 *
 * Only receipts recorded against this job, and only what has not since gone
 * back out. A payment on another job counts for nothing here however large it
 * is -- which is the whole reason this takes a job id rather than a list
 * somebody assembled.
 */
export function netAppliedToJob(
  jobId: string,
  receipts: readonly Receipt[],
  adjustments: readonly Adjustment[]
): number {
  return receipts
    .filter((receipt) => receipt.jobId === jobId)
    .reduce((sum, receipt) => sum + netOfReceipt(receipt, adjustments), 0);
}

/** Whether the money required before the work starts is actually there. */
export function depositSatisfied(requiredCents: number, netCents: number): boolean {
  return netCents >= requiredCents;
}

/** A sentence for the check, saying what came in and what went back out. */
export function describeNet(
  receipts: readonly Receipt[],
  adjustments: readonly Adjustment[],
  jobId: string
): string {
  const mine = receipts.filter((receipt) => receipt.jobId === jobId && receipt.receivedAt != null);
  const ids = new Set(mine.map((receipt) => receipt.id));
  const taken = adjustments
    .filter((adjustment) => ids.has(adjustment.paymentId))
    .reduce((sum, adjustment) => sum + adjustment.amountCents, 0);

  if (mine.length === 0) return "No payment has been recorded against this job";
  const gross = mine.reduce((sum, receipt) => sum + receipt.amountCents, 0);
  if (taken === 0) {
    return `${mine.length} ${mine.length === 1 ? "payment" : "payments"} recorded on this job, none refunded or reversed`;
  }
  return `${money(gross)} taken on this job, ${money(taken)} refunded or reversed since — ${money(gross - taken)} net`;
}

function money(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

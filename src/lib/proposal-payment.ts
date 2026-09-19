/**
 * Whether the money for a sold job has actually arrived.
 *
 * Accepted and paid are different facts and the board only showed the first.
 * A proposal signed in September sat under "Accepted" next to one that was
 * signed and settled the same afternoon, and nothing on the screen told them
 * apart — so chasing money meant opening jobs one at a time.
 *
 * Money reaches a job by four routes and they have to be added up without
 * being counted twice:
 *
 * - the proposal's own settlement, when a client paid in full at checkout;
 * - instalments of a payment plan, as each one clears;
 * - invoices marked paid;
 * - anything recorded by hand — cash, a cheque, a bank transfer.
 *
 * The trap is that a card payment writes a payment row *and* marks its invoice
 * paid, so a naive sum counts it twice and a half-paid job reads as settled.
 * Whoever gathers the numbers is responsible for handing this each pound once;
 * what this decides is only what the total means.
 *
 * Everything is in cents. Amounts here come from four tables that disagree
 * about units, and the conversion belongs at the edge rather than in the
 * middle of a comparison.
 */

export type PaymentState = "unpaid" | "part" | "paid";

/**
 * How far short still counts as paid.
 *
 * A dollar. Card fees, rounding between cents and dollars, and a client who
 * pays a round number all leave small differences, and a job showing as
 * outstanding over four cents is a job somebody wastes a phone call on.
 */
export const SETTLED_TOLERANCE_CENTS = 100;

export interface PaymentFacts {
  /** What was agreed, after any discount. Null when the proposal has no total. */
  totalCents: number | null;
  /** What has arrived and can be tied to this job, counted once. */
  collectedCents: number;
  /**
   * When our own checkout settled the whole thing.
   *
   * Believed over the arithmetic. It is set by the payment flow itself, and
   * the payments it records have historically not all been attributed back to
   * a job — so a job can genuinely be paid while the sum says nothing.
   */
  settledAt?: string | null;
}

/**
 * Paid, part paid, or nothing in.
 *
 * "Part" is worth its own answer rather than being folded into unpaid: a
 * deposit taken is a different conversation from a client who has paid
 * nothing, and it is the one the office most often needs to have.
 */
export function paymentState(facts: PaymentFacts): PaymentState {
  if (facts.settledAt) return "paid";

  const collected = Math.max(0, Math.round(facts.collectedCents || 0));
  if (collected <= 0) return "unpaid";

  const total = facts.totalCents == null ? null : Math.round(facts.totalCents);
  // Money in against no agreed total is money in. Calling that "part paid"
  // would claim we know what is still owed, and we do not.
  if (total == null || total <= 0) return "paid";

  return collected + SETTLED_TOLERANCE_CENTS >= total ? "paid" : "part";
}

/** What is still owed, or zero. Never negative: an overpayment is not a debt. */
export function outstandingCents(facts: PaymentFacts): number {
  if (paymentState(facts) === "paid") return 0;
  const total = facts.totalCents == null ? 0 : Math.round(facts.totalCents);
  return Math.max(0, total - Math.max(0, Math.round(facts.collectedCents || 0)));
}

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** The money line on a row, or null when there is nothing worth saying. */
export function paymentLabel(facts: PaymentFacts): string | null {
  const state = paymentState(facts);
  const collected = Math.max(0, Math.round(facts.collectedCents || 0));

  if (state === "paid") {
    return collected > 0 ? `Paid ${MONEY.format(collected / 100)}` : "Paid";
  }
  if (state === "part") {
    return `${MONEY.format(collected / 100)} in, ${MONEY.format(outstandingCents(facts) / 100)} to come`;
  }
  return null;
}

/** Sort key for a board: the ones owing the most money first. */
export function owedFirst(a: PaymentFacts, b: PaymentFacts): number {
  return outstandingCents(b) - outstandingCents(a);
}

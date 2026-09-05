/**
 * What it costs to take a card, passed on to whoever chose to use one.
 *
 * The processor takes a percentage of every card payment. Across one year of
 * this business that was several thousand dollars, and it came straight off
 * the margin of jobs already priced. A surcharge moves that cost to the
 * payment method that causes it.
 *
 * Two rules shape everything here, and both come from the card networks
 * rather than from taste:
 *
 * A surcharge has to be disclosed before somebody pays, not discovered on the
 * receipt. So it is a line of its own on the checkout and a line of its own
 * on the page before it, never folded into the price.
 *
 * And it is money collected to cover a cost, not money earned. It is kept
 * apart from what the work was sold for, so a job's revenue stays the job's
 * revenue and the reconciliation between what was billed and what arrived
 * does not read a surcharge as an overpayment.
 */

/** Three and a half percent. */
export const SURCHARGE_RATE = 0.035;

export const SURCHARGE_LABEL = "Card processing fee (3.5%)";

/**
 * The fee on an amount, in whole cents.
 *
 * Rounded rather than floored, and worked out from cents rather than from a
 * dollar float: 3.5% of $1,234.56 is not something to discover a penny of
 * error in later, when the total on the receipt has to match the total in the
 * bank.
 */
export function surchargeCents(amountCents: number): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0;
  return Math.round(amountCents * SURCHARGE_RATE);
}

/** What the client is actually charged. */
export function totalWithSurcharge(amountCents: number): number {
  return amountCents + surchargeCents(amountCents);
}

/**
 * Splitting a total back into the work and the fee.
 *
 * The webhook is told what arrived, not what it was made of, and the split
 * has to come back out again — a payment recorded whole would credit the
 * client with paying more for the work than they were billed.
 *
 * Derived from the amount the checkout was built from rather than by
 * reversing the percentage, because reversing a rounded number does not
 * always land back where it started.
 */
export function splitPaidTotal(input: {
  totalCents: number;
  /** What the work was, before the fee, when the caller knows it. */
  workCents?: number | null;
}): { workCents: number; surchargeCents: number } {
  const total = Math.max(0, Math.round(input.totalCents));

  if (input.workCents != null && input.workCents >= 0 && input.workCents <= total) {
    return { workCents: input.workCents, surchargeCents: total - input.workCents };
  }

  // No original to work back from. Undo the percentage, which is right to
  // the penny for anything this charged and never wrong by more than one.
  const work = Math.round(total / (1 + SURCHARGE_RATE));
  return { workCents: work, surchargeCents: total - work };
}

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * What the client reads before they decide.
 *
 * Names the amount rather than only the percentage. "3.5%" is a number
 * somebody has to do arithmetic on while holding a card; "$43.21" is the
 * thing they are actually being asked to agree to.
 */
export function surchargeNotice(amountCents: number): string {
  return `Paying by card adds ${money(surchargeCents(amountCents))} (3.5%) to cover processing. Paying by cash or cheque does not.`;
}

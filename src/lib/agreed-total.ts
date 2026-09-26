/**
 * What the client actually agreed to pay.
 *
 * A proposal carries two numbers: `total_cost`, the price before any
 * discount, and `discount_amount`, what came off it. Every bill, every
 * "still owed" figure and every commission has to run off the difference.
 * Linda Holden was invoiced the full price after taking a ten percent
 * pre-book special because the invoice read the first number and never the
 * second. One helper, used everywhere money is owed, so it cannot happen
 * again.
 */

export interface PricedProposal {
  total_cost: number | string | null | undefined;
  discount_amount?: number | string | null | undefined;
}

/** The agreed price in dollars, or null when the proposal has no total. */
export function agreedTotal(proposal: PricedProposal | null | undefined): number | null {
  if (!proposal || proposal.total_cost == null) return null;
  const gross = Number(proposal.total_cost);
  if (!Number.isFinite(gross)) return null;
  const discount = Number(proposal.discount_amount ?? 0);
  const net = gross - (Number.isFinite(discount) ? discount : 0);
  return Math.max(0, Math.round(net * 100) / 100);
}

/** The agreed price in cents, or null when the proposal has no total. */
export function agreedTotalCents(proposal: PricedProposal | null | undefined): number | null {
  const dollars = agreedTotal(proposal);
  return dollars == null ? null : Math.round(dollars * 100);
}

/**
 * No proposal ever goes out for nothing.
 *
 * A quote left the building at $0 once: the design had no pricing on it,
 * the total was never looked at, and the client got a free job in writing.
 * Every step that makes a price visible or binding runs through here.
 */

export interface PricedLike {
  total_cost: number | string | null | undefined;
  discount_amount?: number | string | null | undefined;
}

/** The price after the discount, in cents. Zero when there is nothing on it. */
export function netProposalCents(proposal: PricedLike): number {
  const total = Number(proposal.total_cost ?? 0);
  const discount = Number(proposal.discount_amount ?? 0);
  const net = (Number.isFinite(total) ? total : 0) - (Number.isFinite(discount) ? discount : 0);
  return Math.round(net * 100);
}

/** Why this proposal cannot be sent, saved as sent, or accepted. Null when it can. */
export function zeroPriceBlocker(proposal: PricedLike): string | null {
  const net = netProposalCents(proposal);
  if (net > 0) return null;
  const discount = Number(proposal.discount_amount ?? 0);
  if (Number(proposal.total_cost ?? 0) > 0 && discount > 0) {
    return "The discount takes this proposal to $0. Fix the price or the discount before it goes out.";
  }
  return "This proposal is $0. Put the price on it before it goes out.";
}

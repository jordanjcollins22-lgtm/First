/**
 * The pricing floor every service is held to.
 *
 * Every job leaves at least half its price as gross profit once the crew's
 * labour, the materials and the account manager's or affiliate's share are
 * paid. Labour is counted in whole hours, an hour at the least, however
 * short the visit: nobody is paid for twenty minutes of a morning, and the
 * crew is out of the shop for the drive there and back either way.
 *
 * Pure, so the arithmetic is tested without a database.
 */

/** The gross profit every job is priced to leave, at least. */
export const GROSS_PROFIT_TARGET = 0.5;

/** Who is paid a share of the job's price for bringing it in or looking after it. */
export interface JobFee {
  kind: "account-manager" | "affiliate" | "pool";
  /** Their first name, or who they are when there is nobody named. */
  name: string;
  /** Their share of the price, in percent: the whole pool, for the pool. */
  pct: number;
  /** The pool, a share at a time: "Jace 7% account manager", "4% affiliate, kept". */
  shares?: string[];
}

export interface Margin {
  priceCents: number;
  labourCents: number;
  materialsCents: number;
  feeCents: number;
  /** Labour, materials and the fee. */
  costCents: number;
  grossCents: number;
  /** Gross profit as a share of the price, 0 to 1. */
  grossPct: number;
  /** At or above the target. */
  meetsTarget: boolean;
}

/**
 * What the job leaves once it is paid for: the price less the crew's labour,
 * the materials and the account manager's or affiliate's share of the price.
 * Overhead is not taken off; gross profit is what pays for it.
 */
export function margin(priceCents: number, labourCents: number, materialsCents: number, feePct: number): Margin {
  const feeCents = Math.round((priceCents * Math.max(0, feePct)) / 100);
  const costCents = labourCents + materialsCents + feeCents;
  const grossCents = priceCents - costCents;
  const grossPct = priceCents > 0 ? grossCents / priceCents : 0;
  return { priceCents, labourCents, materialsCents, feeCents, costCents, grossCents, grossPct, meetsTarget: grossPct >= GROSS_PROFIT_TARGET - 0.0005 };
}

/**
 * The lowest price that leaves the target gross profit after labour,
 * materials and the fee, rounded up to the dollar -- to the dollar a visit,
 * when the crew comes out more than once, so each visit is a round price.
 * Null when the fee alone leaves no room for it.
 */
export function priceForTarget(labourCents: number, materialsCents: number, feePct: number, target = GROSS_PROFIT_TARGET, visits = 1): number | null {
  const room = 1 - target - Math.max(0, feePct) / 100;
  if (room <= 0) return null;
  const each = Math.max(1, Math.round(visits));
  return Math.ceil((labourCents + materialsCents) / room / each / 100) * 100 * each;
}

/** Hours on the clock, charged as whole hours, one at the least. */
export function billedHours(hours: number): number {
  // A hair under a whole hour is that hour, not the next one.
  return Math.max(1, Math.ceil(Math.max(0, hours) - 1e-6));
}

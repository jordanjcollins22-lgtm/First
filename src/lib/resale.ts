/**
 * What we would get back for something we own.
 *
 * A flat share of what it cost. It is a starting point, not a valuation —
 * enough to answer "is selling the old mower worth the afternoon it would
 * take", which is the question anybody actually asks.
 *
 * Two things never have one. A rental, because it was never ours to sell. And
 * a cost — a permit, a delivery fee, somebody else's invoice — because there
 * is nothing behind it to put on the back of a truck.
 */

/** A tenth of what it cost. Deliberately a named constant: when somebody
 * decides it should be fifteen, this is the one line that changes. */
export const RESALE_SHARE = 0.1;

export interface ResaleInput {
  /** What it cost us. */
  cost: number | null;
  /** What somebody said it is worth, if they disagreed with the default. */
  override?: number | null;
  /** Rented, so never ours to sell. */
  isRental?: boolean;
  /** A cost with nothing behind it. */
  isOther?: boolean;
}

/**
 * The number, or nothing.
 *
 * Nothing is a real answer here and is treated as one everywhere it is shown:
 * a dash beats a zero, because a zero reads as "worth nothing" rather than
 * "not a thing you can sell".
 */
export function resaleValue({ cost, override, isRental, isOther }: ResaleInput): number | null {
  if (isRental || isOther) return null;
  if (override != null && override >= 0) return override;
  if (cost == null || cost <= 0) return null;
  return Math.round(cost * RESALE_SHARE * 100) / 100;
}

/** Why there is no number, for a row that would otherwise just show a dash. */
export function resaleReason({ isRental, isOther, cost }: ResaleInput): string | null {
  if (isOther) return "a cost, nothing to sell";
  if (isRental) return "rented, not ours to sell";
  if (cost == null || cost <= 0) return "no cost on it yet";
  return null;
}

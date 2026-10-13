/**
 * When a proposal's price can go to the client without the owner looking.
 *
 * Today every price waits for somebody to press Accept. The report counted
 * three proposals sitting in "needs approval" and found the main reason a
 * person had to look: most services had no rate on them, so the number was a
 * guess. Once the rates are in, a price built from them by the forward
 * pricing equation is not a guess, and the owner looking at it adds a day
 * and nothing else.
 *
 * So a price passes when all three of these hold, and is held otherwise with
 * the reason written out:
 *
 * 1. **Every line has a rate.** Each area's service has a rate on the rate
 *    card, and every service line under it has a production rate and a
 *    quantity. One unpriced line means the total is a floor, not a price.
 * 2. **The margin meets the division's target.** What is left of the price
 *    after the crew's labour, the materials and the commission pool, as a
 *    share of the price, is at or above the target for the division carrying
 *    most of the price.
 * 3. **The price is within ±15% of the formula.** A price typed or
 *    discounted far from what the rates say is a judgement, and a judgement
 *    is what the owner is for.
 *
 * Anything else that would stop a person approving it (wording still to
 * approve, the evaluator still on site, a $0 price) is passed in as a hold
 * too, so the panel shows one list of reasons rather than two.
 *
 * Pure, so the rules are tested without a database.
 */

import { DIVISION_LABEL, dominantDivision, type Division, type DivisionTargets } from "@/lib/sales/divisions";

/** How far from the formula a price may sit and still go on its own. */
export const DEFAULT_FORMULA_TOLERANCE = 0.15;

export interface GuardrailLine {
  /** The area it is in, for the reason. */
  area: string;
  /** The service, in words. */
  label: string;
  division: Division;
  /** Has a production rate (or, for a per-job cost, a cost) to price it from. */
  hasRate: boolean;
  /** How much of it: zero means it was never measured. */
  quantity: number;
  /** What it adds to the formula price, for weighting the division. */
  priceCents: number;
}

export interface GuardrailInput {
  /** What the client would be quoted, after any discount, in cents. */
  priceCents: number;
  /** The forward pricing equation's price for the same lines, in cents. Null when it could not be worked out. */
  formulaCents: number | null;
  /** What the job costs to produce: labour (with travel and time off the work) and materials, in cents. */
  costCents: number | null;
  /** The commission pool and any reserve the price has to pay, as a fraction of the price. */
  sharesOfPrice: number;
  lines: GuardrailLine[];
  /** Areas whose service has no rate on the rate card. */
  areasWithoutCardRate: string[];
  targets: DivisionTargets;
  tolerance?: number;
  /** Anything else holding it, already in words. */
  otherHolds?: string[];
}

export type GuardrailCheck = "rates" | "margin" | "formula" | "other";

export interface GuardrailResult {
  pass: boolean;
  /** One sentence each, in the order the checks run. Empty when it passes. */
  reasons: string[];
  /** Which checks failed, for counting. */
  failed: GuardrailCheck[];
  division: Division;
  target: number;
  /** Gross margin at the quoted price, 0 to 1. Null when there is no cost to work it from. */
  marginPct: number | null;
  /** How far the quoted price sits from the formula, as a fraction: -0.1 is 10% under. */
  deviationPct: number | null;
}

/**
 * Gross margin at a price: what is left after the cost of the work and the
 * shares of the price set aside (commission pool, reserve), over the price.
 */
export function marginAt(priceCents: number, costCents: number, sharesOfPrice: number): number {
  if (priceCents <= 0) return 0;
  return (priceCents - costCents - priceCents * Math.max(0, sharesOfPrice)) / priceCents;
}

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

export function checkGuardrails(input: GuardrailInput): GuardrailResult {
  const tolerance = input.tolerance ?? DEFAULT_FORMULA_TOLERANCE;
  const reasons: string[] = [];
  const failed: GuardrailCheck[] = [];
  const division = dominantDivision(input.lines.length ? input.lines : [{ division: "install", priceCents: 0 }]);
  const target = input.targets[division];

  // 1. Every line has a rate.
  const rateReasons: string[] = [];
  if (input.lines.length === 0) rateReasons.push("No services are priced on it yet.");
  if (input.areasWithoutCardRate.length > 0) {
    rateReasons.push(`No rate on the rate card for ${unique(input.areasWithoutCardRate).join(", ")}.`);
  }
  const unrated = input.lines.filter((l) => !l.hasRate);
  if (unrated.length > 0) rateReasons.push(`No production rate for ${unique(unrated.map((l) => l.label)).join(", ")}.`);
  const unmeasured = input.lines.filter((l) => l.hasRate && !(l.quantity > 0));
  if (unmeasured.length > 0) rateReasons.push(`No quantity on ${unique(unmeasured.map((l) => `${l.label} (${l.area})`)).join(", ")}.`);
  if (rateReasons.length > 0) {
    failed.push("rates");
    reasons.push(...rateReasons);
  }

  // 2. Margin against the division's target.
  const marginPct = input.costCents != null && input.priceCents > 0 ? marginAt(input.priceCents, input.costCents, input.sharesOfPrice) : null;
  if (marginPct == null) {
    failed.push("margin");
    reasons.push("The margin can't be worked out: there is no cost for the work.");
  } else if (marginPct < target - 0.0005) {
    failed.push("margin");
    reasons.push(`Margin ${pct(marginPct)} is under the ${DIVISION_LABEL[division].toLowerCase()} target of ${pct(target)}.`);
  }

  // 3. Within the tolerance of the formula.
  const deviationPct = input.formulaCents != null && input.formulaCents > 0 ? input.priceCents / input.formulaCents - 1 : null;
  if (deviationPct == null) {
    failed.push("formula");
    reasons.push("There is no formula price to check it against.");
  } else if (Math.abs(deviationPct) > tolerance + 1e-9) {
    failed.push("formula");
    reasons.push(
      `${dollars(input.priceCents)} is ${pct(Math.abs(deviationPct))} ${deviationPct < 0 ? "under" : "over"} the formula price of ${dollars(input.formulaCents!)} (allowed ±${pct(tolerance)}).`
    );
  }

  const other = (input.otherHolds ?? []).filter((s) => s.trim() !== "");
  if (other.length > 0) {
    failed.push("other");
    reasons.push(...other);
  }

  return { pass: reasons.length === 0, reasons, failed, division, target, marginPct, deviationPct };
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

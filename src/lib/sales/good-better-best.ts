/**
 * Good / Better / Best: the same job offered three ways, built from the lines
 * the evaluator's walkthrough already priced.
 *
 * - **Better** is the job as priced: what we would recommend. It is marked
 *   as the recommended one.
 * - **Good** is each area's essential work only: the clearing, pulling and
 *   cutting, without the finishing materials (mulch, stone, new plants, seed)
 *   and the extras. A client who would turn the full price down has a yes.
 * - **Best** is Better plus a weed-preventer spray over every bed and lawn
 *   area that is measured in square feet, priced from the production rates
 *   like everything else, so the margin holds.
 *
 * Every option is priced with the forward pricing equation from its own
 * lines, so each one leaves the same gross profit and passes the same
 * guardrails. The options are only offered when they are genuinely
 * different: Good has to be at least 10% under Better, or it is left out and
 * the proposal stays a single price.
 *
 * The existing options machinery (migration 0349, `proposal-options.ts`)
 * shows them side by side on the client's page and writes the chosen
 * option's price onto the proposal when they accept.
 *
 * Pure, so it is tested without a database.
 */

import { priceForward, type PriceLine, type PricingEquation, type ProductionService } from "@/lib/forward-pricing";
import type { ProposalOption, ProposalOptions } from "@/lib/proposal-options";

/** Finishing work and extras: what Good leaves out. */
const FINISHING = new Set([
  "mulch-install",
  "rock-install",
  "plant-install-1gal",
  "plant-install-3gal",
  "plant-relocation",
  "bed-edging",
  "seeding",
  "overseeding",
  "sod-install",
  "topsoil-install",
  "fertilization",
  "weed-spraying",
]);

/** The line Best adds to an area measured in square feet. */
export const BEST_ADD_ON = "weed-spraying";

/** Good has to save at least this much against Better to be worth offering. */
export const MIN_GOOD_SAVING = 0.1;

export interface GbbInput {
  /** Each area's priced lines, in the proposal's area order. */
  areas: PriceLine[][];
  equation: PricingEquation;
  services: ProductionService[];
  driveMinutesPerDay: number | null;
}

function labelOf(key: string, services: ProductionService[]): string {
  return services.find((s) => s.key === key)?.label ?? key;
}

function priceOption(areas: PriceLine[][], input: GbbInput) {
  return priceForward(areas, input.equation, input.services, input.driveMinutesPerDay);
}

/** The three options, or null when they would not be meaningfully different. */
export function buildGoodBetterBest(input: GbbInput): ProposalOptions | null {
  if (input.areas.length === 0) return null;
  const better = input.areas.map((lines) => lines.filter((l) => l.quantity > 0));
  const good = better.map((lines) => {
    const essential = lines.filter((l) => !FINISHING.has(l.key));
    // An area that is nothing but finishing keeps its first line: an area
    // with no work in it would be an area the client is charged nothing for.
    return essential.length > 0 ? essential : lines.slice(0, 1);
  });
  const sprayOn = input.services.some((s) => s.key === BEST_ADD_ON && s.active !== false);
  const best = better.map((lines) => {
    if (!sprayOn || lines.some((l) => l.key === BEST_ADD_ON)) return lines;
    const sf = lines.find((l) => input.services.find((s) => s.key === l.key)?.unit === "SF");
    return sf ? [...lines, { key: BEST_ADD_ON, quantity: sf.quantity, materialCents: 0, note: "Added for Best: weed preventer over the same area." }] : lines;
  });

  const pricedBetter = priceOption(better, input);
  const pricedGood = priceOption(good, input);
  const pricedBest = priceOption(best, input);
  if (pricedBetter.rCents <= 0) return null;

  const options: ProposalOption[] = [];
  const keys = (areas: PriceLine[][]) => new Set(areas.flat().map((l) => l.key));
  const betterKeys = keys(better);
  const goodKeys = keys(good);
  const dropped = [...betterKeys].filter((k) => !goodKeys.has(k)).map((k) => labelOf(k, input.services));
  const includes = (areas: PriceLine[][]) => [...keys(areas)].map((k) => labelOf(k, input.services));

  if (pricedGood.rCents > 0 && pricedGood.rCents <= pricedBetter.rCents * (1 - MIN_GOOD_SAVING)) {
    options.push({
      key: "good",
      name: "Good",
      tagline: "The essential work, without the finishing.",
      totalCents: pricedGood.rCents,
      includes: includes(good),
      notIncluded: dropped,
      areas: pricedGood.areas.map((a, i) => ({ priceCents: a.rCents, lines: good[i] })),
    });
  }
  options.push({
    key: "better",
    name: "Better",
    tagline: "Everything we recommend for this property.",
    totalCents: pricedBetter.rCents,
    includes: includes(better),
    notIncluded: [],
    recommended: true,
    areas: pricedBetter.areas.map((a, i) => ({ priceCents: a.rCents, lines: better[i] })),
  });
  if (pricedBest.rCents > pricedBetter.rCents) {
    options.push({
      key: "best",
      name: "Best",
      tagline: "Everything in Better, plus a weed preventer to keep it clean longer.",
      totalCents: pricedBest.rCents,
      includes: includes(best),
      notIncluded: [],
      areas: pricedBest.areas.map((a, i) => ({ priceCents: a.rCents, lines: best[i] })),
    });
  }
  // Two or more, or it is just the price.
  return options.length >= 2 ? { options, chosen: null } : null;
}

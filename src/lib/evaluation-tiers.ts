/**
 * The paid evaluations a client can book from their estimate instead of
 * putting a deposit down. Either way the business is paid before anybody
 * drives out, and what differs is the first visit: after a deposit the crew
 * comes to work, after a paid evaluation the evaluator comes to evaluate.
 * An evaluation's fee comes off the job if they go ahead.
 *
 * The defaults are placeholders. A business sets its own names, prices and
 * what each includes in organizations.evaluation_tiers; anything missing or
 * malformed there falls back to these.
 */

export type TierId = "basic" | "measured" | "design";

export interface EvaluationTier {
  id: TierId;
  name: string;
  /** Whole cents. */
  priceCents: number;
  /** One line under the name. */
  blurb: string;
  includes: string[];
}

export const TIER_IDS: TierId[] = ["basic", "measured", "design"];

export const DEFAULT_TIERS: EvaluationTier[] = [
  {
    id: "basic",
    name: "Site evaluation",
    priceCents: 9900,
    blurb: "We come out, go over everything with you, and confirm your price.",
    includes: ["We fill out the pre-evaluation with you", "Photos of every area", "Measurements for your proposal"],
  },
  {
    id: "measured",
    name: "Measured plan",
    priceCents: 19900,
    blurb: "Every bed measured and drawn, so you see exactly what you're getting.",
    includes: ["Everything in the site evaluation", "Every bed measured", "Beds drawn on your property map"],
  },
  {
    id: "design",
    name: "Design evaluation",
    priceCents: 39900,
    blurb: "Concept designs and a fully marked-out property.",
    includes: [
      "Everything in the measured plan",
      "Concept designs for your beds",
      "Property lines marked",
      "Utility lines marked",
    ],
  },
];

/** The business's tiers, with the defaults standing in for anything not set or not valid. */
export function readTiers(value: unknown): EvaluationTier[] {
  const custom = new Map<string, Record<string, unknown>>();
  if (Array.isArray(value)) {
    for (const raw of value) {
      if (raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string") custom.set((raw as { id: string }).id, raw as Record<string, unknown>);
    }
  }
  return DEFAULT_TIERS.map((tier) => {
    const c = custom.get(tier.id);
    if (!c) return tier;
    const price = Number(c.priceCents);
    const includes = Array.isArray(c.includes) ? c.includes.filter((x): x is string => typeof x === "string" && x.trim() !== "") : null;
    return {
      id: tier.id,
      name: typeof c.name === "string" && c.name.trim() ? c.name.trim() : tier.name,
      priceCents: Number.isInteger(price) && price > 0 ? price : tier.priceCents,
      blurb: typeof c.blurb === "string" && c.blurb.trim() ? c.blurb.trim() : tier.blurb,
      includes: includes && includes.length > 0 ? includes : tier.includes,
    };
  });
}

export function isTierId(value: unknown): value is TierId {
  return typeof value === "string" && (TIER_IDS as string[]).includes(value);
}

export function tierById(tiers: EvaluationTier[], id: string | null | undefined): EvaluationTier | null {
  return tiers.find((t) => t.id === id) ?? null;
}

/**
 * A price from the pre-evaluation form alone, before anybody has seen the
 * property. Demo only for now: the idea is a quicker checkout for a client
 * who does not want to wait for the visit, at a higher price because the
 * yard has not been walked.
 *
 * It prices through the same rate card as a real proposal. Each service
 * they picked becomes a made-up site map area, sized from the county's lot
 * size and the parts of the yard they said, and costZone prices it exactly
 * as it would price an area an evaluator drew. The unseen-property premium
 * goes on top, and the total rounds up to the next $25.
 *
 * And the other half of the same idea, for after the visit: what the client
 * asked for on the form beside what the evaluator put on the site map, so
 * what the evaluator added is plain to see.
 *
 * Pure, so the sizing and the comparison are tested without a database.
 */

import { costZone } from "@/lib/proposal-pricing";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import type { WorkZone } from "@/components/canvas/types";
import type { IntakeAnswers } from "@/lib/evaluation-intake";

/** How much more a price is before the yard has been seen. */
export const UNSEEN_PREMIUM = 0.2;

/** Assumed when the county has no lot for the address. */
const TYPICAL_LOT_SQFT = 10_000;

/** How much of the yard each part is, roughly. */
const AREA_SHARE: Record<string, number> = { front: 0.3, back: 0.45, sides: 0.15, foundation: 0.1 };

export interface InstantLine {
  /** The form's service, e.g. "beds". */
  service: string;
  /** What it is priced as, from the rate card. Null when there is no rate for it. */
  priceAs: string | null;
  /** What was assumed about its size, in words. */
  assumed: string | null;
  priceCents: number | null;
}

export interface InstantPrice {
  lines: InstantLine[];
  subtotalCents: number;
  premiumCents: number;
  totalCents: number;
  /** What the sizes were worked out from. */
  basis: string;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function yardShare(areas: string[]): number {
  if (areas.includes("whole")) return 1;
  if (areas.length === 0) return 0.5;
  return Math.min(1, areas.reduce((sum, a) => sum + (AREA_SHARE[a] ?? 0), 0));
}

/** The rate card's service for one of the form's services, with the size to assume. */
function plan(
  service: string,
  answers: IntakeAnswers,
  yardSqft: number,
  structureSqft: number,
  findByName: (pattern: RegExp) => string | null
): { typeId: string | null; areaSqft?: number; quantity?: number } {
  const detail = (id: string) => {
    const v = answers.details[id];
    return Array.isArray(v) ? v : v ? [v] : [];
  };
  switch (service) {
    case "beds":
      return { typeId: "landscape-bed", areaSqft: clamp(yardSqft * 0.12, 100, 2000) };
    case "lawn": {
      const repair = detail("lawn_need").some((v) => v === "patch" || v === "redo" || v === "level");
      return { typeId: repair ? "lawn-restoration" : "lawn-care", areaSqft: clamp(yardSqft * 0.7, 500, 40_000) };
    }
    case "cleanup":
      return { typeId: "landscape-cleanup", areaSqft: clamp(yardSqft * 0.25, 200, 10_000) };
    case "removal":
      return { typeId: "plant-bush-removal", quantity: 3 };
    case "drainage":
      return { typeId: "grading", areaSqft: 300 };
    case "washing":
      return { typeId: "soft-washing", areaSqft: clamp(structureSqft * 0.9, 800, 6000) };
    case "snow":
      return { typeId: findByName(/snow/i), areaSqft: 800 };
    default:
      // Patios, holiday lights and anything else are priced at the visit.
      return { typeId: null };
  }
}

export function instantPrice(
  answers: IntakeAnswers,
  lot: { lotSqft: number | null; structureSqft: number | null } | null,
  catalog: Pick<CanvasCatalog, "servicePricing" | "serviceMaterialRules" | "materials" | "crewCostPerHourCents" | "markup" | "measurementUnit" | "measurementBasis">
): InstantPrice {
  const lotSqft = lot?.lotSqft ?? TYPICAL_LOT_SQFT;
  const structureSqft = lot?.structureSqft ?? 2000;
  const footprint = structureSqft / 1.6;
  const yard = Math.max(1500, lotSqft - footprint - 800) * yardShare(answers.areas);
  const active = catalog.servicePricing.filter((p) => p.status === "active");
  const findByName = (pattern: RegExp) => active.find((p) => pattern.test(p.name))?.service_type_id ?? null;

  const lines: InstantLine[] = answers.services.map((service) => {
    const { typeId, areaSqft, quantity } = plan(service, answers, yard, structureSqft, findByName);
    const pricing = typeId ? active.find((p) => p.service_type_id === typeId) : null;
    if (!pricing) return { service, priceAs: null, assumed: null, priceCents: null };
    const side = areaSqft != null ? Math.sqrt(areaSqft) : 0;
    const zone: WorkZone = {
      id: `instant-${service}`,
      name: pricing.name,
      color: "#000000",
      points: [],
      location: "",
      service: { typeId: pricing.service_type_id, values: quantity != null ? { quantity: String(quantity) } : {}, notes: "", photos: [], tools: [] },
      areaSqFt: areaSqft ?? null,
      perimeterFt: areaSqft != null ? Math.round(side * 4) : null,
      measurementKind: areaSqft != null ? "area" : "none",
    };
    const priceCents = costZone(zone, catalog as CanvasCatalog).priceCents;
    return {
      service,
      priceAs: pricing.name,
      assumed: areaSqft != null ? `about ${Math.round(areaSqft).toLocaleString("en-US")} sq ft` : quantity != null ? `about ${quantity}` : null,
      priceCents: priceCents > 0 ? priceCents : null,
    };
  });

  const subtotalCents = lines.reduce((sum, l) => sum + (l.priceCents ?? 0), 0);
  const withPremium = subtotalCents * (1 + UNSEEN_PREMIUM);
  const totalCents = Math.ceil(withPremium / 2500) * 2500;
  return {
    lines,
    subtotalCents,
    premiumCents: totalCents - subtotalCents,
    totalCents: subtotalCents > 0 ? totalCents : 0,
    basis: lot?.lotSqft ? `the county's lot size, ${Math.round(lotSqft).toLocaleString("en-US")} sq ft` : `a typical ${TYPICAL_LOT_SQFT.toLocaleString("en-US")} sq ft lot`,
  };
}

/* ------------------------------------------------ asked for, then found */

/** Which of the rate card's services each of the form's services covers. */
const COVERS: Record<string, { ids: string[]; names?: RegExp }> = {
  beds: { ids: ["landscape-bed", "plant-installation"], names: /mulch|bed|plant/i },
  lawn: { ids: ["lawn-care", "lawn-restoration"], names: /lawn|mow|seed|sod|aerat/i },
  cleanup: { ids: ["landscape-cleanup", "trimming", "leaf-seasonal-cleanup"], names: /clean|trim|leaf|weed|prun/i },
  removal: { ids: ["plant-bush-removal"], names: /remov|junk/i },
  drainage: { ids: ["grading"], names: /grad|drain/i },
  hardscape: { ids: [], names: /patio|walk|wall|paver|hardscape/i },
  washing: { ids: ["soft-washing"], names: /wash/i },
  holiday: { ids: [], names: /holiday|christmas|light/i },
  snow: { ids: [], names: /snow/i },
};

function covered(service: string, area: { typeId: string; label: string }): boolean {
  const rule = COVERS[service];
  if (!rule) return false;
  return rule.ids.includes(area.typeId) || Boolean(rule.names?.test(area.label));
}

export interface UpsellComparison {
  /** What they asked for on the form, by the form's service. */
  asked: string[];
  /** Areas on the site map that nothing they asked for covers: what the evaluator added. */
  added: { label: string; priceCents: number }[];
  /** What they asked for that is nowhere on the site map. */
  notOnMap: string[];
  addedCents: number;
}

/**
 * What the client asked for beside what the evaluator drew. An area is an
 * addition when none of the services they picked covers it; "Something
 * else" is not counted as asking for everything.
 */
export function compareUpsell(asked: string[], areas: { typeId: string; label: string; priceCents: number }[]): UpsellComparison {
  const wanted = asked.filter((s) => s !== "other");
  const added = areas.filter((area) => !wanted.some((service) => covered(service, area)));
  const byLabel = new Map<string, number>();
  for (const area of added) byLabel.set(area.label, (byLabel.get(area.label) ?? 0) + Math.max(0, area.priceCents));
  return {
    asked,
    added: [...byLabel.entries()].map(([label, priceCents]) => ({ label, priceCents })),
    notOnMap: wanted.filter((service) => !areas.some((area) => covered(service, area))),
    addedCents: added.reduce((sum, a) => sum + Math.max(0, a.priceCents), 0),
  };
}

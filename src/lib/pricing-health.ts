/**
 * Pricing health: whether the estimate a client sees the moment they finish
 * the map can be trusted, and what to fix where it can't.
 *
 * The estimate is three things multiplied together: how big each spot is,
 * how long that size takes the crew, and what the materials cost. Sizing gets
 * better on its own as clients trace spots and evaluators draw site maps. The
 * other two only get better when somebody fills in the rate card, and the
 * estimate never complains about a gap: where the rate card has no timing or
 * a material has no cost, a typical figure stands in quietly. That keeps the
 * client's page working, and it also means a business can run for months on
 * placeholders without knowing. So this says, service by service, which
 * numbers are the business's own and which are stand-ins, and what to set.
 *
 * Then the only real test of an estimate: what the proposal came to after
 * somebody walked the yard. A job with both is a measurement, and enough of
 * them say whether the estimates run high, low or about right, and for which
 * kinds of spot.
 *
 * And one known difference between the two prices: the client's estimate is
 * read with the service role, which cannot see the bank, so it charges the
 * flat overhead percentage even where the business quotes overhead per
 * crew-hour. Said plainly, with what it does to a typical job.
 *
 * Pure, so the checks and the statistics are tested without a database.
 */

import { priceZone, type Markup } from "@/lib/job-costing";
import { choiceLabel } from "@/lib/tap-estimate";
import type { ProductionService } from "@/lib/forward-pricing";
import type { Material, ServiceMaterialRule, ServicePricing } from "@/types/domain";

/* ------------------------------------------------------------- rate card */

/** One rate card service the tap estimate can price, and the taps that lead to it. */
export interface TapService {
  typeId: string;
  label: string;
  /** TAP_CHOICES values that are priced as this service. Empty: only reached from the long form. */
  choices: string[];
  /** What one unit is: square feet, or a count. */
  unit: "sq ft" | "shrub" | "plant";
  /**
   * The Production rates service that measures the same work, so a gap can
   * say what to set rather than only that something is missing. sqftPerUnit
   * converts a production unit that isn't square feet (mulch goes down by the
   * cubic yard) to the rate card's.
   */
  production?: { key: string; sqftPerUnit?: number; note?: string };
  /** Whether the rate card can hold it: a service type exists for it to be set on. */
  settable: boolean;
}

/** A cubic yard spread three inches deep covers 108 sq ft. */
const SQFT_PER_CUBIC_YARD_AT_3IN = 108;

/**
 * What the tap estimate prices, in the order a client meets it on the map.
 * The three removals are bed conversions the long pre-evaluation form asks
 * about; there is no service type for them, so they always run on the
 * typical figure until one is added.
 */
export const TAP_SERVICES: TapService[] = [
  {
    typeId: "landscape-bed",
    label: "Beds (mulch or rock)",
    choices: ["mulch", "rock"],
    unit: "sq ft",
    production: { key: "mulch-install", sqftPerUnit: SQFT_PER_CUBIC_YARD_AT_3IN, note: "at 3 inches deep" },
    settable: true,
  },
  { typeId: "plant-installation", label: "Planting", choices: ["plants"], unit: "plant", production: { key: "plant-install-1gal" }, settable: true },
  { typeId: "landscape-cleanup", label: "Weeds and cleanup", choices: ["weeds"], unit: "sq ft", production: { key: "weed-pulling" }, settable: true },
  { typeId: "trimming", label: "Trimming", choices: ["trim"], unit: "shrub", production: { key: "shrub-trimming" }, settable: true },
  { typeId: "plant-bush-removal", label: "Bush removal", choices: ["remove"], unit: "shrub", production: { key: "plant-removal-medium" }, settable: true },
  { typeId: "lawn-restoration", label: "Lawn repair", choices: ["lawn"], unit: "sq ft", production: { key: "seeding" }, settable: true },
  { typeId: "lawn-care", label: "Mowing", choices: ["lawn"], unit: "sq ft", production: { key: "mowing-edging" }, settable: true },
  { typeId: "soft-washing", label: "Soft washing", choices: ["wash"], unit: "sq ft", production: { key: "soft-washing" }, settable: true },
  { typeId: "grading", label: "Drainage regrade", choices: ["water"], unit: "sq ft", production: { key: "hand-grading" }, settable: true },
  { typeId: "stone-removal", label: "Old stone removal", choices: [], unit: "sq ft", settable: false },
  { typeId: "mulch-removal", label: "Old mulch removal", choices: [], unit: "sq ft", settable: false },
  { typeId: "sod-removal", label: "Grass removal for a new bed", choices: [], unit: "sq ft", settable: false },
];

/**
 * How a service is timed when the estimate prices it.
 *   own:     the rate card's minutes, scaled by the size. What it should be.
 *   flat:    the rate card's fixed hours, the same for a small spot and a big one.
 *   typical: no timing the estimate can use, so a stand-in.
 */
export type TimingState = "own" | "flat" | "typical";

export interface RateCardRow {
  typeId: string;
  label: string;
  choices: string[];
  state: TimingState;
  /** The minutes per unit the estimate uses, own or typical. Null when it uses fixed hours or nothing. */
  minutesPerUnit: number | null;
  unit: TapService["unit"];
  crewSize: number;
  /** What is wrong and what it does to the client's number, in a sentence. */
  problem: string | null;
  /** What to set. Null when nothing needs doing. */
  fix: string | null;
  /** A starting figure from Production rates, in the rate card's terms. */
  suggestion: string | null;
}

type CardService = Pick<ServicePricing, "service_type_id" | "name" | "status" | "pricing_basis" | "estimated_hours" | "minutes_per_sqft" | "crew_size">;

const round = (n: number, places = 3) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/**
 * Production rates are per crew clock-hour, the whole crew together. The rate
 * card's minutes are per unit for one crew member, multiplied by its crew
 * size, so the same figure goes in as 60 / units-an-hour with the crew size
 * set to the crew that did it.
 */
function productionSuggestion(service: TapService, production: { services: ProductionService[]; crewPeople: number } | null): string | null {
  if (!production || !service.production) return null;
  const rate = production.services.find((p) => p.key === service.production?.key);
  if (!rate?.pr || rate.pr <= 0 || rate.active === false) return null;
  const unitsAnHour = rate.pr * (service.production.sqftPerUnit ?? 1);
  const minutes = round(60 / unitsAnHour);
  const crew = Math.max(1, production.crewPeople);
  const per = service.unit;
  const how = `${rate.label}: a crew of ${crew} does ${round(unitsAnHour, 1).toLocaleString("en-US")} ${per === "sq ft" ? "sq ft" : `${per}s`} an hour${service.production.note ? `, ${service.production.note}` : ""}`;
  return `${minutes} min per ${per} with a crew of ${crew} (${how}).`;
}

/**
 * Which of the services the tap estimate prices are timed by the business's
 * own rate card, and which run on a stand-in. Follows instantPrice's own
 * order: minutes when the basis lets them be used, then fixed hours, then
 * typical.
 */
export function rateCardHealth(
  services: CardService[],
  typicalMinutes: Record<string, number>,
  production: { services: ProductionService[]; crewPeople: number } | null = null
): RateCardRow[] {
  return TAP_SERVICES.map((service): RateCardRow => {
    const card = services.find((s) => s.service_type_id === service.typeId && s.status === "active") ?? null;
    const typical = typicalMinutes[service.typeId] ?? null;
    const counted = service.unit !== "sq ft";
    const crewSize = card?.crew_size ?? 1;
    const suggestion = productionSuggestion(service, production);
    const base = { typeId: service.typeId, label: card?.name ?? service.label, choices: service.choices, unit: service.unit, crewSize, suggestion };
    const minutes = card?.minutes_per_sqft != null ? Number(card.minutes_per_sqft) : null;
    // instantPrice uses the minutes only where the basis is by size or by
    // count (or the work itself is counted); a perimeter or flat basis
    // silently drops them.
    const minutesUsable = minutes != null && minutes > 0 && card != null && (card.pricing_basis === "area" || card.pricing_basis === "count" || counted);

    if (minutesUsable) return { ...base, state: "own", minutesPerUnit: minutes, problem: null, fix: null };

    const typicalSays = typical != null ? `a typical ${typical} crew-min per ${service.unit}` : "nothing, so it is left to the visit";
    if (!service.settable) {
      return {
        ...base,
        state: "typical",
        minutesPerUnit: typical,
        problem: `There is no service on the rate card for this, so the estimate always uses ${typicalSays}.`,
        fix: "Add it as a service on the rate card only if it comes up often enough to be worth its own timing.",
      };
    }
    if (!card) {
      return {
        ...base,
        state: "typical",
        minutesPerUnit: typical,
        problem: `Not an active service on the rate card, so the estimate uses ${typicalSays}.`,
        fix: `Turn on ${service.label} on the rate card and set its minutes per ${service.unit}.`,
      };
    }
    const ignored =
      minutes != null && minutes > 0 ? ` Its minutes are set but not used, because it is priced by ${card.pricing_basis}; set it to price by ${counted ? "count" : "area"}.` : "";
    if (card.estimated_hours != null && Number(card.estimated_hours) > 0) {
      return {
        ...base,
        state: "flat",
        minutesPerUnit: null,
        problem: `Timed at a fixed ${Number(card.estimated_hours)} crew-hours, so one small spot and a whole yard cost the same.${ignored}`,
        fix: ignored ? `Price ${card.name} by ${counted ? "count" : "area"}.` : `Set minutes per ${service.unit} on ${card.name}.`,
      };
    }
    return {
      ...base,
      state: "typical",
      minutesPerUnit: typical,
      problem: `No timing on the rate card, so the estimate uses ${typicalSays}.${ignored}`,
      fix: ignored ? `Price ${card.name} by ${counted ? "count" : "area"}.` : `Set minutes per ${service.unit} on ${card.name}.`,
    };
  });
}

/* ------------------------------------------------------------- materials */

/** A material the estimate needs for a kind of spot, found by the rule that picks it. */
const EXPECTED_MATERIALS: { typeId: string; values: Record<string, string>; what: string; choice: string }[] = [
  { typeId: "landscape-bed", values: { material: "Mulch" }, what: "mulch", choice: "mulch" },
  { typeId: "landscape-bed", values: { material: "Rock" }, what: "river rock", choice: "rock" },
  { typeId: "lawn-restoration", values: {}, what: "seed", choice: "lawn" },
];

export interface MaterialRow {
  /** Null for a material the rate card has no rule for at all. */
  materialId: string | null;
  name: string;
  /** Which rate card service uses it. */
  typeId: string;
  /**
   *   no-rule:     nothing on the rate card says which material this spot uses, so none is priced.
   *   no-coverage: the rule is there but the material has no coverage, so it is never counted.
   *   no-cost:     counted, but with no cost; a typical cost stands in, or it is left out.
   */
  problem: "no-rule" | "no-coverage" | "no-cost";
  say: string;
  fix: string;
}

type CardMaterial = Pick<Material, "id" | "name" | "unit" | "coverage_per_unit_sqft" | "cost_per_unit">;
type CardRule = Pick<ServiceMaterialRule, "service_type_id" | "material_id" | "match_field" | "match_value">;

/** Whether a rule applies to a spot with these values: zoneMaterialLineItems' own test. */
function ruleApplies(rule: CardRule, values: Record<string, string>): boolean {
  return !rule.match_field || values[rule.match_field] === rule.match_value;
}

/**
 * The materials the estimate prices, and where their numbers are missing.
 * Only the services the tap estimate prices; materials are the active job
 * stock the estimate reads.
 */
export function materialHealth(
  rules: CardRule[],
  materials: CardMaterial[],
  typicalCents: { name: RegExp; cents: number }[]
): MaterialRow[] {
  const rows: MaterialRow[] = [];
  const seen = new Set<string>();
  const priced = new Set(TAP_SERVICES.map((s) => s.typeId));

  for (const expected of EXPECTED_MATERIALS) {
    const found = rules.some((r) => r.service_type_id === expected.typeId && ruleApplies(r, expected.values) && materials.some((m) => m.id === r.material_id));
    if (found) continue;
    const service = TAP_SERVICES.find((s) => s.typeId === expected.typeId);
    rows.push({
      materialId: null,
      name: expected.what[0].toUpperCase() + expected.what.slice(1),
      typeId: expected.typeId,
      problem: "no-rule",
      say: `A "${choiceLabel(expected.choice)}" spot is priced with no ${expected.what} at all: nothing on the rate card links ${service?.label.toLowerCase() ?? expected.typeId} to it.`,
      fix: `Link the ${expected.what} material to ${service?.label ?? expected.typeId} on the rate card${Object.keys(expected.values).length ? ` (for ${Object.values(expected.values).join(", ")})` : ""}.`,
    });
  }

  for (const rule of rules) {
    if (!priced.has(rule.service_type_id)) continue;
    const material = materials.find((m) => m.id === rule.material_id);
    if (!material || seen.has(material.id)) continue;
    seen.add(material.id);
    if (!material.coverage_per_unit_sqft || material.coverage_per_unit_sqft <= 0) {
      rows.push({
        materialId: material.id,
        name: material.name,
        typeId: rule.service_type_id,
        problem: "no-coverage",
        say: `${material.name} has no coverage, so the estimate can't tell how much a spot needs and leaves it out.`,
        fix: `Set how many sq ft one ${material.unit || "unit"} of ${material.name} covers.`,
      });
      continue;
    }
    if (material.cost_per_unit == null) {
      const typical = typicalCents.find((t) => t.name.test(material.name));
      rows.push({
        materialId: material.id,
        name: material.name,
        typeId: rule.service_type_id,
        problem: "no-cost",
        say: typical
          ? `${material.name} has no cost, so the estimate uses a typical $${(typical.cents / 100).toFixed(2)} per ${material.unit || "unit"}.`
          : `${material.name} has no cost, and there is no typical one, so the estimate leaves it out.`,
        fix: `Set what one ${material.unit || "unit"} of ${material.name} costs.`,
      });
    }
  }
  return rows;
}

/* -------------------------------------------------------------- accuracy */

/** One job that has both an estimate and a proposal. */
export interface EstimatePair {
  jobId: string;
  label: string;
  /** What the client was shown, cushion included. */
  estimateCents: number;
  /** The estimate before the unseen-yard cushion, when it was kept. */
  estimateSubtotalCents: number | null;
  /** The proposal's price before any discount: a discount is a sales decision, not a size or a rate. */
  proposalCents: number;
  /** TAP_CHOICES values on the job's spots. */
  choices: string[];
  status: string;
}

export interface JobAccuracy extends EstimatePair {
  /** (estimate - proposal) / proposal, in percent. Positive: the estimate was high. */
  diffPct: number;
  /** The same for the estimate before its cushion. */
  subtotalDiffPct: number | null;
  within: boolean;
}

export interface ChoiceAccuracy {
  choice: string;
  label: string;
  jobs: number;
  medianPct: number;
  within: number;
}

export interface AccuracySummary {
  jobs: JobAccuracy[];
  tolerancePct: number;
  /** Median signed difference: which way estimates lean. Null with no jobs. */
  medianPct: number | null;
  /** Median size of the miss, either way. */
  medianAbsPct: number | null;
  /** The median before the cushion: how close the sizes and rates are on their own. */
  medianSubtotalPct: number | null;
  within: number;
  high: number;
  low: number;
  /** By what the client tapped. A job counts under each choice on it. */
  byChoice: ChoiceAccuracy[];
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const pct = (estimate: number, proposal: number) => round(((estimate - proposal) / proposal) * 100, 1);

/**
 * How the estimates compare with the proposals that followed them. A pair
 * with nothing on either side says nothing and is left out rather than
 * counted as a miss of 100%.
 */
export function estimateAccuracy(pairs: EstimatePair[], tolerancePct = 15): AccuracySummary {
  const jobs: JobAccuracy[] = pairs
    .filter((p) => p.estimateCents > 0 && p.proposalCents > 0)
    .map((p) => {
      const diffPct = pct(p.estimateCents, p.proposalCents);
      return {
        ...p,
        diffPct,
        subtotalDiffPct: p.estimateSubtotalCents != null && p.estimateSubtotalCents > 0 ? pct(p.estimateSubtotalCents, p.proposalCents) : null,
        within: Math.abs(diffPct) <= tolerancePct,
      };
    })
    .sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));

  const byChoiceMap = new Map<string, JobAccuracy[]>();
  for (const job of jobs) {
    for (const choice of new Set(job.choices)) {
      const list = byChoiceMap.get(choice) ?? [];
      list.push(job);
      byChoiceMap.set(choice, list);
    }
  }
  const byChoice: ChoiceAccuracy[] = [...byChoiceMap.entries()]
    .map(([choice, list]) => ({
      choice,
      label: choiceLabel(choice),
      jobs: list.length,
      medianPct: median(list.map((j) => j.diffPct)) ?? 0,
      within: list.filter((j) => j.within).length,
    }))
    .sort((a, b) => b.jobs - a.jobs || Math.abs(b.medianPct) - Math.abs(a.medianPct));

  const subtotals = jobs.map((j) => j.subtotalDiffPct).filter((n): n is number => n != null);
  return {
    jobs,
    tolerancePct,
    medianPct: median(jobs.map((j) => j.diffPct)),
    medianAbsPct: median(jobs.map((j) => Math.abs(j.diffPct))),
    medianSubtotalPct: median(subtotals),
    within: jobs.filter((j) => j.within).length,
    high: jobs.filter((j) => !j.within && j.diffPct > 0).length,
    low: jobs.filter((j) => !j.within && j.diffPct < 0).length,
    byChoice,
  };
}

/* -------------------------------------------------------------- overhead */

export interface OverheadParity {
  /** True when the client's estimate charges overhead the way the proposal will. */
  same: boolean;
  headline: string;
  detail: string;
  /** A typical job priced both ways, so the difference is a number, not a principle. */
  example: {
    crewHours: number;
    materialsCents: number;
    staffCents: number;
    estimateCents: number;
    diffPct: number;
    /** The flat percentage that would price this job the same both ways. */
    matchingPercent: number;
  } | null;
}

/** The job the example is worked on: a day for a crew of two, and a load of mulch. */
const EXAMPLE_JOB = { crewHours: 16, materialsCents: 30_000 };

export function overheadParity(input: {
  basis: "percent" | "per_diem";
  overheadPercent: number;
  /** What the per diem comes to a crew-hour, in cents. Null or 0: nothing to spread yet. */
  perCrewHourCents: number | null;
  multiplier: number;
  crewCostPerHourCents: number;
}): OverheadParity {
  const percent = `${input.overheadPercent}%`;
  if (input.basis === "percent") {
    return {
      same: true,
      headline: `Same overhead both ways: a flat ${percent}.`,
      detail: "The business charges overhead as a percentage, and so does the client's estimate, so the two prices are built the same way.",
      example: null,
    };
  }
  if (!input.perCrewHourCents || input.perCrewHourCents <= 0) {
    return {
      same: true,
      headline: `Overhead per crew-hour is chosen, but there is nothing to spread yet, so both use the flat ${percent}.`,
      detail: "Once the bank's recurring costs come through, proposals will charge overhead by the hour and the client's estimate will still use the percentage.",
      example: null,
    };
  }

  const zone = { materialsCents: EXAMPLE_JOB.materialsCents, crewHours: EXAMPLE_JOB.crewHours, crewCostPerHourCents: input.crewCostPerHourCents };
  const staffMarkup: Markup = { multiplier: input.multiplier, overheadPercent: input.overheadPercent, overheadPerCrewHourCents: input.perCrewHourCents };
  const estimateMarkup: Markup = { multiplier: input.multiplier, overheadPercent: input.overheadPercent, overheadPerCrewHourCents: null };
  const staffCents = priceZone(zone, staffMarkup).priceCents;
  const estimateCents = priceZone(zone, estimateMarkup).priceCents;
  const diffPct = staffCents > 0 ? round(((estimateCents - staffCents) / staffCents) * 100, 1) : 0;
  const perHour = `$${(input.perCrewHourCents / 100).toFixed(2)}`;
  const way = diffPct < 0 ? "lower" : "higher";
  const direct = zone.materialsCents + zone.crewHours * zone.crewCostPerHourCents;
  const multiplied = direct * input.multiplier;
  const matchingPercent = multiplied > 0 ? round(((EXAMPLE_JOB.crewHours * input.perCrewHourCents) / multiplied) * 100, 1) : input.overheadPercent;

  return {
    same: false,
    headline: `Proposals charge ${perHour} overhead per crew-hour; the client's estimate charges a flat ${percent}.`,
    detail:
      `The estimate is worked out for somebody without an account, and the per crew-hour figure comes off the bank, which only a signed-in user can read, so the estimate falls back to the percentage. ` +
      `On a long, labour-heavy job the percentage collects ${diffPct < 0 ? "less" : "more"} than the hours would, so estimates on those jobs run ${way} than the proposal for a reason that has nothing to do with sizes. ` +
      `To close most of it, set the flat percentage to what the per crew-hour figure comes to on a typical job: about ${matchingPercent}% on the one below.`,
    example: { ...EXAMPLE_JOB, staffCents, estimateCents, diffPct, matchingPercent },
  };
}

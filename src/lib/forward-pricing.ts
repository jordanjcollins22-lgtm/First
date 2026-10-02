/**
 * Forward pricing: the price worked backwards from what the work costs to
 * produce, so that every share of the price the business sets aside (gross
 * profit, the affiliate, the evaluator, the account manager, any reserve) is
 * paid for by the price rather than taken out of the crew's time.
 *
 *   PLH = Q ÷ PR                         projected crew-hours, per service
 *   CR  = (NPL × PLR) + (NPT × PTR)      the crew's hourly pay, together
 *   PLC = PLH × CR                       projected labour cost
 *   RA  = GP% + A% + E% + AM% + GR%      revenue already allocated
 *   PCM = 1 − RA                         what is left for cost
 *   R   = (M + PLC) ÷ PCM                the price
 *
 * Each service has one production rate (PR), its own, used on every job:
 * hand weed pulling is one rate, weed spraying another, plant removal
 * another. Hours are crew-hours, the clock while the crew (a lead and a
 * technician) is on site, because CR is the whole crew's rate.
 *
 * The production rates here are starting figures, not history: the crew
 * logs a job's start and finish, not each service's, so PR = Q ÷ ALH cannot
 * be worked out from past jobs yet. They are the figures to replace.
 *
 * Pure, so the arithmetic is tested without a database.
 */

export type ProductionUnit = "SF" | "CY" | "plant" | "bush" | "job";

export interface ProductionService {
  key: string;
  label: string;
  unit: ProductionUnit;
  /** Units one crew-hour produces. Null for a cost with no crew time, like disposal. */
  pr: number | null;
  /** Material or direct cost per unit, in cents, when it uses any. */
  materialCentsPerUnit?: number;
  /** What that material is, in words. */
  materialName?: string;
}

/** Every service the price is built from, with its production rate. */
export const PRODUCTION_SERVICES: ProductionService[] = [
  { key: "weed-pulling", label: "Hand weed pulling", unit: "SF", pr: 600 },
  { key: "weed-spraying", label: "Weed spraying", unit: "SF", pr: 3000, materialCentsPerUnit: 2, materialName: "Herbicide" },
  { key: "perennial-cutback", label: "Perennial cut-back / overgrowth removal", unit: "SF", pr: 500 },
  { key: "debris-cleanup", label: "Debris cleanup", unit: "SF", pr: 800 },
  { key: "plant-removal-small", label: "Plant removal, small", unit: "plant", pr: 6 },
  { key: "plant-removal-medium", label: "Plant / bush removal, medium", unit: "plant", pr: 3 },
  { key: "bush-removal-large", label: "Bush removal, large (with roots)", unit: "bush", pr: 1 },
  { key: "plant-cutback", label: "Plant cut-back", unit: "plant", pr: 12 },
  { key: "shrub-trimming", label: "Shrub trimming", unit: "plant", pr: 8 },
  { key: "plant-relocation", label: "Plant relocation", unit: "plant", pr: 6 },
  { key: "mulch-install", label: "Mulch install", unit: "CY", pr: 2.5, materialCentsPerUnit: 3500, materialName: "Mulch" },
  { key: "plant-install-1gal", label: "Plant installation, 1 gal", unit: "plant", pr: 12, materialCentsPerUnit: 800, materialName: "Plants" },
  { key: "plant-install-3gal", label: "Plant installation, 3 gal", unit: "plant", pr: 6, materialCentsPerUnit: 2500, materialName: "Plants" },
  { key: "mowing-edging", label: "Mowing + edging", unit: "SF", pr: 6000 },
  { key: "disposal", label: "Disposal", unit: "job", pr: null, materialCentsPerUnit: 4000, materialName: "Dump fee" },
];

const SERVICE_BY_KEY = new Map(PRODUCTION_SERVICES.map((s) => [s.key, s]));

export function productionService(key: string): ProductionService | null {
  return SERVICE_BY_KEY.get(key) ?? null;
}

/** The crew and the shares of the price set aside. */
export interface PricingEquation {
  /** NPL and PLR. */
  leads: number;
  leadRateCents: number;
  /** NPT and PTR. */
  technicians: number;
  technicianRateCents: number;
  /** GP%, A%, E%, AM% and GR%, as fractions. */
  grossProfit: number;
  affiliate: number;
  evaluator: number;
  accountManager: number;
  reserve: number;
}

/**
 * The crew and allocations as they stand. The pay rates are the training
 * example's ($45 a lead, $30 a technician), not confirmed pay.
 */
export const PRICING_EQUATION: PricingEquation = {
  leads: 1,
  leadRateCents: 4500,
  technicians: 1,
  technicianRateCents: 3000,
  grossProfit: 0.5,
  affiliate: 0.04,
  evaluator: 0.04,
  accountManager: 0.07,
  reserve: 0,
};

/** CR = (NPL × PLR) + (NPT × PTR). */
export function crewRateCents(eq: PricingEquation): number {
  return eq.leads * eq.leadRateCents + eq.technicians * eq.technicianRateCents;
}

/** RA = GP% + A% + E% + AM% + GR%. */
export function revenueAllocation(eq: PricingEquation): number {
  return eq.grossProfit + eq.affiliate + eq.evaluator + eq.accountManager + eq.reserve;
}

/** PCM = 1 − RA. */
export function projectCostMargin(eq: PricingEquation): number {
  return 1 - revenueAllocation(eq);
}

/** One service on one area: how much of it, and any material or direct cost. */
export interface PriceLine {
  key: string;
  /** Q, in the service's unit. */
  quantity: number;
  /** M for this line, in cents. */
  materialCents: number;
  /** Where Q came from, or what is missing. */
  note?: string | null;
}

export interface PricedLine extends PriceLine {
  label: string;
  unit: ProductionUnit;
  pr: number | null;
  /** PLH = Q ÷ PR, in crew-hours. */
  plh: number;
  /** PLC = PLH × CR, in cents (unrounded, so lines add up to the job's). */
  plcCents: number;
  /** R = (M + PLC) ÷ PCM, in cents, rounded. */
  rCents: number;
}

export function priceLine(line: PriceLine, eq: PricingEquation): PricedLine {
  const service = productionService(line.key);
  const pr = service?.pr ?? null;
  const quantity = Math.max(0, Number.isFinite(line.quantity) ? line.quantity : 0);
  const materialCents = Math.max(0, Math.round(Number.isFinite(line.materialCents) ? line.materialCents : 0));
  const plh = pr && pr > 0 ? quantity / pr : 0;
  const plcCents = plh * crewRateCents(eq);
  const pcm = projectCostMargin(eq);
  return {
    ...line,
    quantity,
    materialCents,
    label: service?.label ?? line.key,
    unit: service?.unit ?? "job",
    pr,
    plh,
    plcCents,
    rCents: pcm > 0 ? Math.round((materialCents + plcCents) / pcm) : 0,
  };
}

export interface PricedArea {
  lines: PricedLine[];
  plh: number;
  plcCents: number;
  materialCents: number;
  /** M + PLC. */
  costCents: number;
  /** The lines' prices added up, so the area's price is exactly its lines. */
  rCents: number;
}

export function priceArea(lines: PriceLine[], eq: PricingEquation): PricedArea {
  const priced = lines.map((l) => priceLine(l, eq));
  const plcCents = priced.reduce((s, l) => s + l.plcCents, 0);
  const materialCents = priced.reduce((s, l) => s + l.materialCents, 0);
  return {
    lines: priced,
    plh: priced.reduce((s, l) => s + l.plh, 0),
    plcCents,
    materialCents,
    costCents: materialCents + plcCents,
    rCents: priced.reduce((s, l) => s + l.rCents, 0),
  };
}

export interface Allocations {
  grossProfitCents: number;
  affiliateCents: number;
  evaluatorCents: number;
  accountManagerCents: number;
  reserveCents: number;
}

/** A = R × A%, E = R × E%, AM = R × AM%, GP = R × GP%, GR = R × GR%. */
export function allocations(rCents: number, eq: PricingEquation): Allocations {
  return {
    grossProfitCents: Math.round(rCents * eq.grossProfit),
    affiliateCents: Math.round(rCents * eq.affiliate),
    evaluatorCents: Math.round(rCents * eq.evaluator),
    accountManagerCents: Math.round(rCents * eq.accountManager),
    reserveCents: Math.round(rCents * eq.reserve),
  };
}

export interface PricedJob {
  areas: PricedArea[];
  plh: number;
  plcCents: number;
  materialCents: number;
  costCents: number;
  rCents: number;
  allocations: Allocations;
}

export function priceForward(areas: PriceLine[][], eq: PricingEquation): PricedJob {
  const priced = areas.map((lines) => priceArea(lines, eq));
  const sum = (pick: (a: PricedArea) => number) => priced.reduce((s, a) => s + pick(a), 0);
  const rCents = sum((a) => a.rCents);
  return {
    areas: priced,
    plh: sum((a) => a.plh),
    plcCents: sum((a) => a.plcCents),
    materialCents: sum((a) => a.materialCents),
    costCents: sum((a) => a.costCents),
    rCents,
    allocations: allocations(rCents, eq),
  };
}

/** What the walkthrough recorded about an area, for suggesting its services. */
export interface AreaFacts {
  typeId: string;
  /** The rate card's name for the service, e.g. "Weed Removal". */
  serviceName: string;
  values: Record<string, unknown>;
  notes: string | null;
  areaSqFt: number | null;
}

const sf = (n: number) => `${Math.round(n).toLocaleString("en-US")} sq ft`;

function count(values: Record<string, unknown>, key: string): number | null {
  const n = Number(String(values[key] ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function text(values: Record<string, unknown>, key: string): string {
  return String(values[key] ?? "").trim();
}

/**
 * The services an area most likely needs, from what the evaluator recorded:
 * its service, its answers, its notes and its measurement. A starting point
 * for the account manager, who can change any quantity, remove a line or add
 * one. Anything the walkthrough did not record (a count, a size) is left at
 * nothing and said, rather than guessed.
 */
export function suggestLines(area: AreaFacts): PriceLine[] {
  const v = area.values ?? {};
  const notes = `${area.notes ?? ""} ${text(v, "specialInstructions")} ${text(v, "desiredResult")}`;
  const size = area.areaSqFt != null && area.areaSqFt > 0 ? area.areaSqFt : null;
  const bySize = (key: string, from = "the walkthrough's measurement"): PriceLine =>
    size != null ? { key, quantity: size, materialCents: 0, note: `${sf(size)}, ${from}` } : { key, quantity: 0, materialCents: 0, note: "Not measured on the walkthrough. Type the square feet." };
  // "1 plant", "3 plants", "1 bush", "2 bushes".
  const byCount = (key: string, n: number | null, what: string): PriceLine =>
    n != null
      ? { key, quantity: n, materialCents: 0, note: `${n} ${n === 1 ? what.replace(/e?s$/, "") : what}, from the walkthrough` }
      : { key, quantity: 0, materialCents: 0, note: `No count on the walkthrough. Type how many ${what}.` };
  const weedy = (level: string) => level !== "" && !/^none$/i.test(level);
  const lines: PriceLine[] = [];
  const name = `${area.typeId} ${area.serviceName}`.toLowerCase();

  if (/weed/.test(name)) {
    // Anywhere that is sprayed is pulled first.
    lines.push(bySize("weed-pulling"));
    if (/spray/i.test(notes)) lines.push(bySize("weed-spraying"));
    if (/cut(ting)?\s*back|perennial/i.test(notes)) lines.push(bySize("perennial-cutback"));
  } else if (area.typeId === "plant-bush-removal") {
    const n = count(v, "quantity");
    const s = text(v, "size").toLowerCase();
    const what = /bush/i.test(text(v, "type")) ? "bushes" : "plants";
    lines.push(byCount(s === "large" ? "bush-removal-large" : s === "medium" ? "plant-removal-medium" : "plant-removal-small", n, what));
  } else if (area.typeId === "trimming") {
    const n = count(v, "quantity");
    lines.push(byCount(/cut\s*back/i.test(notes) ? "plant-cutback" : "shrub-trimming", n, "plants"));
  } else if (area.typeId === "landscape-cleanup") {
    lines.push(bySize("debris-cleanup"));
    if (weedy(text(v, "weedLevel"))) lines.push(bySize("weed-pulling"));
  } else if (area.typeId === "landscape-bed") {
    if (weedy(text(v, "weedLevel"))) lines.push(bySize("weed-pulling"));
    const moved = count(v, "plantRelocation__qty");
    if (moved != null) lines.push(byCount("plant-relocation", moved, "plants"));
    if (/mulch/i.test(text(v, "material"))) {
      if (size != null) {
        // Two inches deep, to the next half yard.
        const yards = Math.ceil(((size * (2 / 12)) / 27) * 2) / 2;
        lines.push({ key: "mulch-install", quantity: yards, materialCents: 0, note: `${sf(size)} at 2 inches deep` });
      } else lines.push({ key: "mulch-install", quantity: 0, materialCents: 0, note: "Not measured on the walkthrough. Type the yards." });
    }
  } else if (area.typeId === "plant-installation") {
    const big = /3\s*gal/i.test(text(v, "sizeContainer"));
    lines.push(byCount(big ? "plant-install-3gal" : "plant-install-1gal", count(v, "quantity"), "plants"));
  } else if (area.typeId === "lawn-care") {
    lines.push(bySize("mowing-edging"));
  }

  // Each service's material at its typical cost, for the quantity.
  return lines.map((l) => {
    const s = productionService(l.key);
    return s?.materialCentsPerUnit ? { ...l, materialCents: Math.round(l.quantity * s.materialCentsPerUnit) } : l;
  });
}

const HAULS_AWAY = new Set(["weed-pulling", "perennial-cutback", "debris-cleanup", "plant-removal-small", "plant-removal-medium", "bush-removal-large", "plant-cutback", "shrub-trimming"]);

/**
 * Every area's suggested services, with one disposal line for the whole job
 * on the area with the most to haul away, when anything is hauled away.
 */
export function suggestJob(areas: AreaFacts[], eq: PricingEquation = PRICING_EQUATION): PriceLine[][] {
  const out = areas.map(suggestLines);
  let most = -1;
  let mostHours = 0;
  out.forEach((lines, i) => {
    const hours = priceArea(lines.filter((l) => HAULS_AWAY.has(l.key)), eq).plh;
    if (hours > mostHours) {
      mostHours = hours;
      most = i;
    }
  });
  if (most >= 0) {
    out[most] = [...out[most], { key: "disposal", quantity: 1, materialCents: productionService("disposal")!.materialCentsPerUnit!, note: "The whole job's dump fee. A typical figure: set it." }];
  }
  return out;
}

/**
 * Lines sent back from the page, made safe: only services that exist, no
 * negative quantities or costs, and at most a sensible number per area.
 */
export function readLines(input: unknown, areaCount: number): PriceLine[][] | null {
  if (!Array.isArray(input) || input.length !== areaCount) return null;
  return input.map((area) =>
    (Array.isArray(area) ? area : [])
      .slice(0, 30)
      .filter((l): l is Record<string, unknown> => l != null && typeof l === "object" && productionService(String((l as Record<string, unknown>).key)) != null)
      .map((l) => ({
        key: String(l.key),
        quantity: Math.min(1_000_000, Math.max(0, Number(l.quantity) || 0)),
        materialCents: Math.min(100_000_000, Math.max(0, Math.round(Number(l.materialCents) || 0))),
        note: typeof l.note === "string" ? l.note.slice(0, 200) : null,
      }))
  );
}

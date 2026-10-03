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
 * The rates, the crew's pay and the materials are set on Admin, Production
 * rates; the figures here are what is used until they are. They are starting
 * figures, not history: the crew logs a job's start and finish, not each
 * service's, so PR = Q ÷ ALH cannot be worked out from past jobs yet.
 *
 * Pure, so the arithmetic is tested without a database.
 */

export type ProductionUnit = "SF" | "LF" | "CY" | "plant" | "bush" | "job";

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
  /**
   * The inventory items it is bought as, with their photo and link. Unset:
   * matched from the material's name. Empty: none.
   */
  materialIds?: string[];
  /** Which part of the "Add a service" list it sits under. Other when not set. */
  group?: ServiceGroup;
  /**
   * Off: not suggested and not offered to add, though a price already saved
   * with it still prices. Services are turned off rather than deleted, so an
   * old proposal can always be read back.
   */
  active?: boolean;
}

export const PRODUCTION_UNITS: { unit: ProductionUnit; label: string }[] = [
  { unit: "SF", label: "Square feet" },
  { unit: "LF", label: "Linear feet" },
  { unit: "CY", label: "Cubic yards" },
  { unit: "plant", label: "Plants" },
  { unit: "bush", label: "Bushes" },
  { unit: "job", label: "Per job (no crew time)" },
];

/** The sections of the "Add a service" list, in order. */
export const SERVICE_GROUPS = ["Weeds and cleanup", "Plants and shrubs", "Beds and materials", "Lawn", "Seasonal", "Washing and gutters", "Other"] as const;
export type ServiceGroup = (typeof SERVICE_GROUPS)[number];

/**
 * Every service the price is built from, with its production rate.
 *
 * From lawn restoration down, the rates and material costs are starting
 * estimates for a crew of two, added so every kind of area on the
 * walkthrough can be priced. Check them on Production rates before leaning
 * on them; the service timers will show what the crew actually does.
 */
export const PRODUCTION_SERVICES: ProductionService[] = [
  { key: "weed-pulling", label: "Hand weed pulling", unit: "SF", pr: 600, group: "Weeds and cleanup" },
  { key: "weed-spraying", label: "Weed spraying", unit: "SF", pr: 3000, materialCentsPerUnit: 2, materialName: "Herbicide", group: "Weeds and cleanup" },
  { key: "perennial-cutback", label: "Perennial cut-back / overgrowth removal", unit: "SF", pr: 500, group: "Weeds and cleanup" },
  { key: "debris-cleanup", label: "Debris cleanup", unit: "SF", pr: 800, group: "Weeds and cleanup" },
  { key: "plant-removal-small", label: "Plant removal, small", unit: "plant", pr: 6, group: "Plants and shrubs" },
  { key: "plant-removal-medium", label: "Plant / bush removal, medium", unit: "plant", pr: 3, group: "Plants and shrubs" },
  { key: "bush-removal-large", label: "Bush removal, large (with roots)", unit: "bush", pr: 1, group: "Plants and shrubs" },
  { key: "plant-cutback", label: "Plant cut-back", unit: "plant", pr: 12, group: "Plants and shrubs" },
  { key: "shrub-trimming", label: "Shrub trimming", unit: "plant", pr: 8, group: "Plants and shrubs" },
  { key: "plant-relocation", label: "Plant relocation", unit: "plant", pr: 6, group: "Plants and shrubs" },
  { key: "mulch-install", label: "Mulch install", unit: "CY", pr: 2.5, materialCentsPerUnit: 3500, materialName: "Mulch", group: "Beds and materials" },
  { key: "plant-install-1gal", label: "Plant installation, 1 gal", unit: "plant", pr: 12, materialCentsPerUnit: 800, materialName: "Plants", group: "Plants and shrubs" },
  { key: "plant-install-3gal", label: "Plant installation, 3 gal", unit: "plant", pr: 6, materialCentsPerUnit: 2500, materialName: "Plants", group: "Plants and shrubs" },
  { key: "mowing-edging", label: "Mowing + edging", unit: "SF", pr: 6000, group: "Lawn" },
  { key: "disposal", label: "Disposal", unit: "job", pr: null, materialCentsPerUnit: 4000, materialName: "Dump fee", group: "Other" },
  // Starting estimates (see above).
  { key: "rock-install", label: "Rock install", unit: "CY", pr: 1.5, materialCentsPerUnit: 6000, materialName: "Rock", group: "Beds and materials" },
  { key: "material-removal", label: "Old mulch / rock removal", unit: "CY", pr: 1.5, group: "Beds and materials" },
  { key: "bed-edging", label: "Bed edging (cut a new edge)", unit: "LF", pr: 150, group: "Beds and materials" },
  { key: "soil-prep", label: "Soil prep (rake out and level)", unit: "SF", pr: 1000, group: "Lawn" },
  { key: "topsoil-install", label: "Topsoil spread", unit: "CY", pr: 2, materialCentsPerUnit: 4000, materialName: "Topsoil", group: "Lawn" },
  { key: "hand-grading", label: "Grading by hand", unit: "SF", pr: 400, group: "Lawn" },
  { key: "seeding", label: "Seeding (seed, rake in, straw)", unit: "SF", pr: 2000, materialCentsPerUnit: 3, materialName: "Seed and straw", group: "Lawn" },
  { key: "sod-install", label: "Sod installation", unit: "SF", pr: 400, materialCentsPerUnit: 50, materialName: "Sod", group: "Lawn" },
  { key: "overseeding", label: "Overseeding", unit: "SF", pr: 5000, materialCentsPerUnit: 1, materialName: "Seed", group: "Lawn" },
  { key: "aeration", label: "Core aeration", unit: "SF", pr: 10000, group: "Lawn" },
  { key: "fertilization", label: "Fertilization", unit: "SF", pr: 20000, materialCentsPerUnit: 1, materialName: "Fertilizer", group: "Lawn" },
  { key: "leaf-removal", label: "Leaf removal", unit: "SF", pr: 3000, group: "Seasonal" },
  { key: "leaf-removal-heavy", label: "Leaf removal, heavy", unit: "SF", pr: 1500, group: "Seasonal" },
  { key: "snow-removal", label: "Snow removal (shovel and blow)", unit: "SF", pr: 1500, group: "Seasonal" },
  { key: "soft-washing", label: "Soft washing", unit: "SF", pr: 1000, materialCentsPerUnit: 2, materialName: "Cleaner", group: "Washing and gutters" },
  { key: "gutter-cleaning", label: "Gutter cleaning", unit: "LF", pr: 100, group: "Washing and gutters" },
];

/**
 * The saved services plus any added to the list since they were saved, so a
 * new service shows up without the settings having to be saved again. Saved
 * ones keep their rates; nothing is ever dropped.
 */
export function withNewServices(saved: ProductionService[], defaults: ProductionService[] = PRODUCTION_SERVICES): ProductionService[] {
  const have = new Set(saved.map((s) => s.key));
  const byKey = new Map(defaults.map((s) => [s.key, s]));
  return [...saved.map((s) => (s.group ? s : { ...s, group: byKey.get(s.key)?.group })), ...defaults.filter((s) => !have.has(s.key))];
}

/** Services that are on, in their sections, for the "Add a service" list. Empty sections are left out. */
export function servicesByGroup(services: ProductionService[]): { group: ServiceGroup; services: ProductionService[] }[] {
  const on = services.filter((s) => s.active !== false);
  return SERVICE_GROUPS.map((group) => ({ group, services: on.filter((s) => (s.group ?? "Other") === group) })).filter((g) => g.services.length > 0);
}

export function productionService(key: string, services: ProductionService[] = PRODUCTION_SERVICES): ProductionService | null {
  return services.find((s) => s.key === key) ?? null;
}

const isOn = (s: ProductionService | null): s is ProductionService => s != null && s.active !== false;

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
  /** The crew's paid day, in hours. */
  workdayHours: number;
  /**
   * The share of that day spent working at the job. The rest goes on the
   * drive, loading, the dump and breaks, and is paid all the same.
   */
  onJobShare: number;
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
  workdayHours: 8,
  onJobShare: 0.75,
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

export function priceLine(line: PriceLine, eq: PricingEquation, services: ProductionService[] = PRODUCTION_SERVICES): PricedLine {
  const service = productionService(line.key, services);
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
  /** The lines' prices added up, so the area's price is exactly its lines, plus its share of time off the work once priced as a job. */
  rCents: number;
  /** Its share of the job's travel and time off the work, by its crew-hours. Nothing until priced as a job. */
  offWork: { plh: number; plcCents: number; rCents: number };
}

export function priceArea(lines: PriceLine[], eq: PricingEquation, services: ProductionService[] = PRODUCTION_SERVICES): PricedArea {
  const priced = lines.map((l) => priceLine(l, eq, services));
  const plcCents = priced.reduce((s, l) => s + l.plcCents, 0);
  const materialCents = priced.reduce((s, l) => s + l.materialCents, 0);
  return {
    lines: priced,
    plh: priced.reduce((s, l) => s + l.plh, 0),
    plcCents,
    materialCents,
    costCents: materialCents + plcCents,
    rCents: priced.reduce((s, l) => s + l.rCents, 0),
    offWork: { plh: 0, plcCents: 0, rCents: 0 },
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

/**
 * The time the crew is paid for but not working at the job: the drive there
 * and back every day, loading, the dump, breaks.
 *
 * A day holds workdayHours × onJobShare hours of work at the job (8 × 75%
 * is 6), so the work takes that many days. The time off the work is the
 * larger of the rest of those days, pro rata (a quarter as much again as
 * the work, at 75%), and the actual drive there and back each day. A small
 * job close by pays mostly its drive; a big one pays its quarter of every
 * day, which covers the drive.
 */
export interface OffWork {
  /** Days at the job, the work at onJobShare of each. */
  days: number;
  /** Hours of work at the job in one day. */
  workHoursPerDay: number;
  /** The drive there and back, in minutes a day; null when it could not be worked out. */
  driveMinutesPerDay: number | null;
  /** Crew-hours paid but not working at the job. */
  plh: number;
  plcCents: number;
  /** Which it came to: the share of the day, or the drive. */
  by: "share" | "drive" | "none";
}

export function offWork(workPlh: number, eq: PricingEquation, driveMinutesPerDay: number | null = null): OffWork {
  const share = eq.onJobShare > 0 && eq.onJobShare <= 1 ? eq.onJobShare : 1;
  const workHoursPerDay = Math.max(0.5, eq.workdayHours * share);
  const drive = driveMinutesPerDay != null && Number.isFinite(driveMinutesPerDay) && driveMinutesPerDay > 0 ? driveMinutesPerDay : null;
  if (!(workPlh > 0)) return { days: 0, workHoursPerDay, driveMinutesPerDay: drive, plh: 0, plcCents: 0, by: "none" };
  const days = Math.ceil(workPlh / workHoursPerDay - 1e-9);
  const byShare = workPlh * (1 / share - 1);
  const byDrive = drive != null ? (days * drive) / 60 : 0;
  const plh = Math.max(byShare, byDrive);
  return { days, workHoursPerDay, driveMinutesPerDay: drive, plh, plcCents: plh * crewRateCents(eq), by: plh <= 0 ? "none" : byDrive > byShare ? "drive" : "share" };
}

export interface PricedJob {
  areas: PricedArea[];
  /** All crew-hours paid: the work and the time off it. */
  plh: number;
  plcCents: number;
  materialCents: number;
  costCents: number;
  rCents: number;
  allocations: Allocations;
  offWork: OffWork;
}

/**
 * The whole job. Its time off the work is shared across the areas by their
 * crew-hours, so each area's price carries its part and the areas still add
 * up to the job.
 */
export function priceForward(
  areas: PriceLine[][],
  eq: PricingEquation,
  services: ProductionService[] = PRODUCTION_SERVICES,
  driveMinutesPerDay: number | null = null
): PricedJob {
  const pcm = projectCostMargin(eq);
  const worked = areas.map((lines) => priceArea(lines, eq, services));
  const workPlh = worked.reduce((s, a) => s + a.plh, 0);
  const off = offWork(workPlh, eq, driveMinutesPerDay);
  const priced = worked.map((a) => {
    const part = workPlh > 0 ? a.plh / workPlh : 0;
    const plh = off.plh * part;
    const plcCents = off.plcCents * part;
    const rCents = pcm > 0 ? Math.round(plcCents / pcm) : 0;
    return { ...a, plh: a.plh + plh, plcCents: a.plcCents + plcCents, costCents: a.costCents + plcCents, rCents: a.rCents + rCents, offWork: { plh, plcCents, rCents } };
  });
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
    offWork: off,
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
export function suggestLines(area: AreaFacts, services: ProductionService[] = PRODUCTION_SERVICES): PriceLine[] {
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
  // Spread or dug out this many inches deep, to the next half yard.
  const byDepth = (key: string, inches: number): PriceLine =>
    size != null
      ? { key, quantity: Math.ceil(((size * (inches / 12)) / 27) * 2) / 2, materialCents: 0, note: `${sf(size)} at ${inches} inch${inches === 1 ? "" : "es"} deep` }
      : { key, quantity: 0, materialCents: 0, note: "Not measured on the walkthrough. Type the yards." };
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
    if (/needs removal/i.test(text(v, "existingMaterialCondition"))) lines.push(byDepth("material-removal", 2));
    const material = text(v, "material");
    if (/mulch/i.test(material)) lines.push(byDepth("mulch-install", 2));
    else if (/rock/i.test(material)) lines.push(byDepth("rock-install", 2));
    if (/no edge|needs redone/i.test(text(v, "edge"))) lines.push({ key: "bed-edging", quantity: 0, materialCents: 0, note: "The walkthrough measures area, not length. Type the linear feet of edge." });
  } else if (area.typeId === "plant-installation") {
    const big = /3\s*gal/i.test(text(v, "sizeContainer"));
    lines.push(byCount(big ? "plant-install-3gal" : "plant-install-1gal", count(v, "quantity"), "plants"));
  } else if (area.typeId === "lawn-care") {
    const kind = text(v, "serviceType");
    lines.push(
      bySize(
        /fertili/i.test(kind) ? "fertilization" : /weed/i.test(kind) ? "weed-spraying" : /aerat/i.test(kind) ? "aeration" : /overseed/i.test(kind) ? "overseeding" : "mowing-edging"
      )
    );
  } else if (area.typeId === "lawn-restoration") {
    if (/needs correction/i.test(text(v, "grade"))) lines.push(bySize("hand-grading"));
    if (/topsoil/i.test(text(v, "soilCondition"))) lines.push(byDepth("topsoil-install", 1));
    lines.push(bySize("soil-prep"));
    if (/sod/i.test(text(v, "method"))) lines.push(bySize("sod-install"));
    else lines.push(bySize(/thin/i.test(text(v, "condition")) ? "overseeding" : "seeding"));
  } else if (area.typeId === "leaf-seasonal-cleanup") {
    const kind = text(v, "type");
    if (!/^fall cutback$/i.test(kind)) lines.push(bySize(/heavy|extreme/i.test(text(v, "leafVolume")) ? "leaf-removal-heavy" : "leaf-removal"));
    if (/cutback|full/i.test(kind)) lines.push(bySize("perennial-cutback"));
  } else if (area.typeId === "grading") {
    lines.push(bySize("hand-grading"));
  } else if (area.typeId === "soft-washing") {
    lines.push(bySize("soft-washing"));
  } else if (/snow/.test(name)) {
    // Kinds of area the business added itself, matched by their name.
    lines.push(bySize("snow-removal"));
  } else if (/\bsod\b/.test(name)) {
    lines.push(bySize("soil-prep"), bySize("sod-install"));
  } else if (/gutter/.test(name)) {
    lines.push({ key: "gutter-cleaning", quantity: 0, materialCents: 0, note: "Type the linear feet of gutter." });
  }

  // Only services that are on, each with its material at its set cost.
  return lines.flatMap((l) => {
    const s = productionService(l.key, services);
    if (!isOn(s)) return [];
    return [s.materialCentsPerUnit ? { ...l, materialCents: Math.round(l.quantity * s.materialCentsPerUnit) } : l];
  });
}

const HAULS_AWAY = new Set([
  "weed-pulling",
  "perennial-cutback",
  "debris-cleanup",
  "plant-removal-small",
  "plant-removal-medium",
  "bush-removal-large",
  "plant-cutback",
  "shrub-trimming",
  "material-removal",
  "leaf-removal",
  "leaf-removal-heavy",
]);

/**
 * Every area's suggested services, with one disposal line for the whole job
 * on the area with the most to haul away, when anything is hauled away.
 */
export function suggestJob(areas: AreaFacts[], eq: PricingEquation = PRICING_EQUATION, services: ProductionService[] = PRODUCTION_SERVICES): PriceLine[][] {
  const out = areas.map((a) => suggestLines(a, services));
  let most = -1;
  let mostHours = 0;
  out.forEach((lines, i) => {
    const hours = priceArea(lines.filter((l) => HAULS_AWAY.has(l.key)), eq, services).plh;
    if (hours > mostHours) {
      mostHours = hours;
      most = i;
    }
  });
  const disposal = productionService("disposal", services);
  if (most >= 0 && isOn(disposal)) {
    out[most] = [...out[most], { key: "disposal", quantity: 1, materialCents: disposal.materialCentsPerUnit ?? 0, note: "The whole job's dump fee. Check it." }];
  }
  return out;
}

/**
 * Lines sent back from the page, made safe: only services that exist, no
 * negative quantities or costs, and at most a sensible number per area.
 */
export function readLines(input: unknown, areaCount: number, services: ProductionService[] = PRODUCTION_SERVICES): PriceLine[][] | null {
  if (!Array.isArray(input) || input.length !== areaCount) return null;
  return input.map((area) =>
    (Array.isArray(area) ? area : [])
      .slice(0, 30)
      .filter((l): l is Record<string, unknown> => l != null && typeof l === "object" && productionService(String((l as Record<string, unknown>).key), services) != null)
      .map((l) => ({
        key: String(l.key),
        quantity: Math.min(1_000_000, Math.max(0, Number(l.quantity) || 0)),
        materialCents: Math.min(100_000_000, Math.max(0, Math.round(Number(l.materialCents) || 0))),
        note: typeof l.note === "string" ? l.note.slice(0, 200) : null,
      }))
  );
}

/** Everything a price is worked out from: the crew and shares, and every service's rate. */
export interface PricingSetup {
  equation: PricingEquation;
  services: ProductionService[];
}

export const DEFAULT_SETUP: PricingSetup = { equation: PRICING_EQUATION, services: PRODUCTION_SERVICES };

/** What one unit of a service is priced at, for the settings page: (CR ÷ PR + M per unit) ÷ PCM, in cents. */
export function pricePerUnitCents(service: ProductionService, eq: PricingEquation): number | null {
  const pcm = projectCostMargin(eq);
  if (pcm <= 0) return null;
  const labour = service.pr && service.pr > 0 ? crewRateCents(eq) / service.pr : 0;
  return (labour + (service.materialCentsPerUnit ?? 0)) / pcm;
}

/** A key for a service added on the settings page, from its name: "Sod install" → "sod-install-3f9a". */
export function serviceKey(label: string, taken: string[], random: () => number = Math.random): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "service";
  let key = base;
  while (taken.includes(key)) key = `${base}-${Math.floor(random() * 0xffff).toString(16).padStart(4, "0")}`;
  return key;
}

const UNITS = new Set(PRODUCTION_UNITS.map((u) => u.unit));

/**
 * The settings page's form, made safe: crew counts and pay within reason,
 * services with a name, a known unit, a rate above nothing (or none, per
 * job), and no negative costs. Null, with what is wrong, when it can't be.
 */
export function readSetup(input: unknown): { ok: true; setup: PricingSetup } | { ok: false; error: string } {
  const o = (input ?? {}) as Record<string, unknown>;
  const e = (o.equation ?? {}) as Record<string, unknown>;
  const int = (v: unknown) => Math.round(Number(v));
  const leads = int(e.leads);
  const technicians = int(e.technicians);
  const leadRateCents = int(e.leadRateCents);
  const technicianRateCents = int(e.technicianRateCents);
  if (![leads, technicians].every((n) => Number.isFinite(n) && n >= 0 && n <= 20)) return { ok: false, error: "The crew is between 0 and 20 people of each kind." };
  if (leads + technicians === 0) return { ok: false, error: "The crew needs at least one person." };
  if (![leadRateCents, technicianRateCents].every((n) => Number.isFinite(n) && n >= 0 && n <= 50_000)) return { ok: false, error: "Hourly pay is between $0 and $500." };
  const list = Array.isArray(o.services) ? o.services : [];
  if (list.length === 0 || list.length > 200) return { ok: false, error: "Keep at least one service." };
  const services: ProductionService[] = [];
  const keys = new Set<string>();
  for (const raw of list) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const key = String(r.key ?? "").trim();
    const label = String(r.label ?? "").trim().slice(0, 80);
    const unit = String(r.unit ?? "") as ProductionUnit;
    if (!/^[a-z0-9-]{1,60}$/.test(key) || keys.has(key)) return { ok: false, error: "A service is missing its key. Reload the page." };
    if (!label) return { ok: false, error: "Every service needs a name." };
    if (!UNITS.has(unit)) return { ok: false, error: `Pick a unit for ${label}.` };
    const pr = unit === "job" ? null : Number(r.pr);
    if (pr !== null && !(Number.isFinite(pr) && pr > 0 && pr <= 1_000_000)) return { ok: false, error: `Give ${label} a production rate above 0.` };
    const material = Math.round(Number(r.materialCentsPerUnit ?? 0));
    if (!Number.isFinite(material) || material < 0 || material > 10_000_000) return { ok: false, error: `${label}'s material cost can't be negative.` };
    keys.add(key);
    services.push({
      key,
      label,
      unit,
      pr,
      ...(material > 0 ? { materialCentsPerUnit: material } : {}),
      ...(String(r.materialName ?? "").trim() ? { materialName: String(r.materialName).trim().slice(0, 60) } : {}),
      ...((SERVICE_GROUPS as readonly string[]).includes(String(r.group ?? "")) ? { group: r.group as ServiceGroup } : {}),
      ...(Array.isArray(r.materialIds)
        ? { materialIds: [...new Set(r.materialIds.map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 5) }
        : {}),
      active: r.active !== false,
    });
  }
  return { ok: true, setup: { equation: { ...PRICING_EQUATION, leads, technicians, leadRateCents, technicianRateCents }, services } };
}

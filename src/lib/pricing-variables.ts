/**
 * Every number the project pricing report is worked out from, in one place:
 * the 97 production rates, the condition multipliers, logistics minutes,
 * travel, the crew, crew pay (pay for performance), the indirect cost pool,
 * capacity and the capacity multipliers.
 *
 * These are the code's starting figures. Once the business saves its own on
 * Admin › Variables they are kept in business_variables (migration 0371) and
 * read back through readVariables, which fills anything missing or unreadable
 * from here, so a price can always be worked out.
 *
 * Pricing (Jordan's Job Calculator):
 *   IR = IC₉₀ ÷ PM₉₀       indirect cost per elapsed project minute
 *   IĈ = IR × PM̂          the job's share of indirect cost
 *   Ĉ  = DĈ + IĈ          estimated total cost
 *   U  = booked ÷ available hours
 *   P  = Ĉ × μ(U)          the price
 *
 * Pure, so it is tested without a database.
 */

import { PRODUCTION_RATES_SEED, type ProductionRateSeed, type RateUnit } from "@/lib/production-rates-seed";

export type { RateUnit };
export type ProductionRate = ProductionRateSeed;

/* ------------------------------------------------------------------ */
/* Conditions                                                          */
/* ------------------------------------------------------------------ */

export const CONDITION_KEYS = ["weeds", "access", "slope", "soil", "overgrowth"] as const;
export type ConditionKey = (typeof CONDITION_KEYS)[number];

export interface ConditionOption {
  value: string;
  label: string;
}

/** Which tasks a condition slows down. */
export interface ConditionScope {
  all?: boolean;
  categories?: string[];
  units?: RateUnit[];
  tasks?: string[];
  /** Never these, even when the rest matches: the rate already has the condition in it. */
  exceptTasks?: string[];
}

export interface ConditionDef {
  key: ConditionKey;
  label: string;
  /** What it applies to, in words, for the variables page and the report. */
  appliesToLabel: string;
  scope: ConditionScope;
  options: ConditionOption[];
  /** The option an area gets until somebody says otherwise. */
  defaultOption: string;
}

const WEED_TASKS = ["bed-preparation.light-weed-removal", "bed-preparation.moderate-weed-removal", "bed-preparation.heavy-weed-removal"];

/** Tasks that dig into the ground, for the soil condition. */
const DIGGING_TASKS = [
  "bed-preparation.root-removal",
  "bed-preparation.small-plant-removal",
  "bed-preparation.medium-plant-removal",
  "bed-preparation.large-plant-removal",
  "bed-preparation.small-shrub-removal",
  "bed-preparation.medium-shrub-removal",
  "bed-preparation.large-shrub-removal",
  "bed-preparation.small-stump-removal",
  "bed-preparation.bed-edging",
  "bed-preparation.soil-cultivation",
  "bed-preparation.soil-excavation-manual",
  "plant-maintenance.small-plant-relocation",
  "plant-maintenance.medium-plant-relocation",
  "plant-maintenance.large-plant-relocation",
  "bed-installation.soil-amendment-incorporation",
  "bed-installation.small-perennial-installation",
  "bed-installation.one-gallon-plant-installation",
  "bed-installation.three-gallon-shrub-installation",
  "bed-installation.five-gallon-shrub-installation",
  "bed-installation.small-tree-installation",
  "bed-installation.landscape-edging-installation",
  "lawn-services.seedbed-preparation",
  "lawn-services.lawn-soil-cultivation",
  "lawn-services.sod-removal",
  "drainage-and-hardscape.manual-trench-excavation",
  "drainage-and-hardscape.drainage-pipe-installation",
];

/** Trimming and cut-back work, for the overgrowth condition. */
const TRIMMING_TASKS = [
  "plant-maintenance.small-shrub-trimming",
  "plant-maintenance.medium-shrub-trimming",
  "plant-maintenance.large-shrub-trimming",
  "plant-maintenance.hedge-trimming",
  "plant-maintenance.perennial-cutback",
  "plant-maintenance.ornamental-grass-cutback",
  "plant-maintenance.small-tree-pruning",
  "plant-maintenance.vine-trimming",
  "bed-preparation.ivy-removal-fence",
  "bed-preparation.brush-clearing",
];

export const CONDITIONS: ConditionDef[] = [
  {
    key: "weeds",
    label: "Weed density",
    appliesToLabel: "Bed prep and bed install work in the area (not the weed removal tasks, whose rates already differ by density)",
    scope: { categories: ["Bed preparation", "Bed installation"], exceptTasks: WEED_TASKS },
    options: [
      { value: "light", label: "Light" },
      { value: "moderate", label: "Moderate" },
      { value: "heavy", label: "Heavy" },
    ],
    defaultOption: "light",
  },
  {
    key: "access",
    label: "Access",
    appliesToLabel: "Moving material and debris: every CY and TON task, sod, and truck unloading",
    scope: { units: ["CY", "TON"], tasks: ["lawn-services.sod-installation"] },
    options: [
      { value: "easy", label: "Easy (truck at the area)" },
      { value: "tight", label: "Tight (gates, wheelbarrow only)" },
      { value: "none", label: "No truck access (long carry)" },
    ],
    defaultOption: "easy",
  },
  {
    key: "slope",
    label: "Slope",
    appliesToLabel: "Every task in the area",
    scope: { all: true },
    options: [
      { value: "flat", label: "Flat" },
      { value: "moderate", label: "Moderate (walkable)" },
      { value: "steep", label: "Steep (hard to stand on)" },
    ],
    defaultOption: "flat",
  },
  {
    key: "soil",
    label: "Soil",
    appliesToLabel: "Digging: removals, planting, edging, cultivation, excavation, trenching",
    scope: { tasks: DIGGING_TASKS },
    options: [
      { value: "soft", label: "Soft" },
      { value: "hard", label: "Hard / clay" },
      { value: "rocky", label: "Rocky" },
    ],
    defaultOption: "soft",
  },
  {
    key: "overgrowth",
    label: "Plant size / overgrowth",
    appliesToLabel: "Trimming, cut-backs, pruning, brush and fence ivy",
    scope: { tasks: TRIMMING_TASKS },
    options: [
      { value: "maintained", label: "Kept to size" },
      { value: "overgrown", label: "Overgrown (a season missed)" },
      { value: "neglected", label: "Neglected (years missed)" },
    ],
    defaultOption: "maintained",
  },
];

export type ConditionMultipliers = Record<ConditionKey, Record<string, number>>;

/** Starting multipliers on labour minutes. Assumptions, not measured: change them as jobs are timed. */
export const DEFAULT_CONDITION_MULTIPLIERS: ConditionMultipliers = {
  weeds: { light: 1, moderate: 1.15, heavy: 1.35 },
  access: { easy: 1, tight: 1.2, none: 1.5 },
  slope: { flat: 1, moderate: 1.15, steep: 1.4 },
  soil: { soft: 1, hard: 1.25, rocky: 1.5 },
  overgrowth: { maintained: 1, overgrown: 1.3, neglected: 1.6 },
};

export type AreaConditions = Partial<Record<ConditionKey, string>>;

export function conditionDef(key: ConditionKey): ConditionDef {
  return CONDITIONS.find((c) => c.key === key)!;
}

export function conditionApplies(scope: ConditionScope, rate: Pick<ProductionRate, "key" | "category" | "unit">): boolean {
  if (scope.exceptTasks?.includes(rate.key)) return false;
  if (scope.all) return true;
  return Boolean(scope.categories?.includes(rate.category) || scope.units?.includes(rate.unit) || scope.tasks?.includes(rate.key));
}

/* ------------------------------------------------------------------ */
/* The variables                                                       */
/* ------------------------------------------------------------------ */

export interface LogisticsMinutes {
  /** Clock minutes, the whole crew, each day. */
  setup: number;
  breakdown: number;
  /** Per item, each day. */
  smallUnload: number;
  largeUnload: number;
  /** Labour minutes per cubic yard of material brought in (stone by the ton counts at 1.4 t a yard). */
  stagingPerCy: number;
  /** Clock minutes, once a job. */
  walkthrough: number;
  inspection: number;
  /** How many items come off the truck a day, when the project doesn't say. */
  smallItemsPerDay: number;
  largeItemsPerDay: number;
}

export interface TravelSettings {
  /** Shop to the property, when it couldn't be worked out from the map. */
  driveMinutesEachWay: number;
  /** One stop for the materials, when there are any. */
  pickupMinutes: number;
  /** One run to the dump, there and back with the wait (the workbook says measure it). */
  disposalTripMinutes: number;
  /** Tip fee a load. From forward-pricing.ts (disposal, $40). */
  dumpFeeCents: number;
}

export interface CrewSettings {
  leads: number;
  techs: number;
  /** A person's paid day, in hours, the drive included. */
  hoursPerDay: number;
}

export interface PaySettings {
  /** Share of labour revenue (P − DĈ) paid to the crew working the job. */
  p4pShare: number;
  /** A lead's share of the pool per hour, against a tech's 1. */
  leadWeight: number;
  /** Nobody is paid under this an hour worked, however the job runs. */
  minWageCents: number;
}

export type InputSource = "app" | "manual";

export interface IndirectSettings {
  /** "app": the bank feed and the crew's clock where they have data, the figures below where not. */
  source: InputSource;
  /** IC₉₀, entered by hand: the indirect cost of the last 90 days. */
  ic90Cents: number;
  /** PM₉₀, entered by hand: elapsed project minutes in the last 90 days. */
  pm90Minutes: number;
}

export interface CapacitySettings {
  /** "app": booked hours from the scheduled proposals, available from the crews below. */
  source: InputSource;
  bookedHours: number;
  availableHours: number;
  /** For working out available hours. */
  crews: number;
  workdaysPerWeek: number;
  windowWeeks: number;
}

export interface CapacityBand {
  /** U below this (a fraction, 0.6 is 60%); null for the top band. */
  below: number | null;
  multiplier: number;
}

export interface PricingVariables {
  rates: ProductionRate[];
  conditions: ConditionMultipliers;
  logistics: LogisticsMinutes;
  travel: TravelSettings;
  crew: CrewSettings;
  pay: PaySettings;
  indirect: IndirectSettings;
  capacity: CapacitySettings;
  bands: CapacityBand[];
}

/** μ(U), from Jordan's Job Calculator. */
export const DEFAULT_BANDS: CapacityBand[] = [
  { below: 0.6, multiplier: 2.0 },
  { below: 0.8, multiplier: 2.1 },
  { below: 0.9, multiplier: 2.2 },
  { below: 1.0, multiplier: 2.3 },
  { below: null, multiplier: 2.4 },
];

export const DEFAULT_VARIABLES: PricingVariables = {
  rates: PRODUCTION_RATES_SEED,
  conditions: DEFAULT_CONDITION_MULTIPLIERS,
  logistics: {
    setup: 10,
    breakdown: 10,
    smallUnload: 3,
    largeUnload: 10,
    stagingPerCy: 10,
    walkthrough: 10,
    inspection: 10,
    smallItemsPerDay: 4,
    largeItemsPerDay: 1,
  },
  travel: { driveMinutesEachWay: 30, pickupMinutes: 30, disposalTripMinutes: 45, dumpFeeCents: 4000 },
  crew: { leads: 1, techs: 1, hoursPerDay: 8 },
  // The lead weight mirrors today's $45 lead / $30 technician pay (1.5 to 1).
  // Maryland's minimum wage, assumed: check it each January.
  pay: { p4pShare: 0.38, leadWeight: 1.5, minWageCents: 1500 },
  // Placeholders until the bank feed and the crew's clock have 90 days in
  // them: $48,000 of indirect cost over 455 crew hours (13 weeks × 5 days ×
  // 7 hours on the clock).
  indirect: { source: "app", ic90Cents: 4_800_000, pm90Minutes: 27_300 },
  capacity: { source: "app", bookedHours: 112, availableHours: 160, crews: 1, workdaysPerWeek: 5, windowWeeks: 4 },
  bands: DEFAULT_BANDS,
};

/** Implied gross margin of a multiplier: 1 − 1/μ. */
export function impliedMargin(multiplier: number): number {
  return multiplier > 0 ? 1 - 1 / multiplier : 0;
}

/* ------------------------------------------------------------------ */
/* Reading what was saved                                              */
/* ------------------------------------------------------------------ */

const num = (v: unknown, fallback: number, min: number, max: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const source = (v: unknown, fallback: InputSource): InputSource => (v === "app" || v === "manual" ? v : fallback);

/**
 * Saved variables, made safe: anything missing, out of range or not a number
 * is the starting figure. Rates are matched by key, so a rate added to the
 * workbook later shows up with its seed figure, and one somebody saved keeps
 * theirs. Never throws.
 */
export function readVariables(input: unknown, defaults: PricingVariables = DEFAULT_VARIABLES): PricingVariables {
  const raw = obj(input);
  const savedRates = new Map<string, unknown>();
  if (Array.isArray(raw.rates)) for (const r of raw.rates) savedRates.set(String(obj(r).key ?? ""), obj(r).unitsPerLaborMinute);
  const rates = defaults.rates.map((r) => ({ ...r, unitsPerLaborMinute: num(savedRates.get(r.key), r.unitsPerLaborMinute, 1e-6, 100_000) }));

  const conds = obj(raw.conditions);
  const conditions = Object.fromEntries(
    CONDITION_KEYS.map((key) => {
      const saved = obj(conds[key]);
      return [key, Object.fromEntries(Object.entries(defaults.conditions[key]).map(([opt, m]) => [opt, num(saved[opt], m, 0.1, 10)]))];
    })
  ) as ConditionMultipliers;

  const pick = <T extends object>(saved: unknown, base: T, ranges: Partial<Record<keyof T, [number, number]>>): T => {
    const s = obj(saved);
    const out = { ...base } as Record<string, unknown>;
    for (const [k, range] of Object.entries(ranges) as [string, [number, number]][]) out[k] = num(s[k], (base as Record<string, number>)[k], range[0], range[1]);
    return out as T;
  };

  const logistics = pick(raw.logistics, defaults.logistics, {
    setup: [0, 600],
    breakdown: [0, 600],
    smallUnload: [0, 120],
    largeUnload: [0, 120],
    stagingPerCy: [0, 240],
    walkthrough: [0, 240],
    inspection: [0, 240],
    smallItemsPerDay: [0, 50],
    largeItemsPerDay: [0, 20],
  });
  const travel = pick(raw.travel, defaults.travel, { driveMinutesEachWay: [0, 240], pickupMinutes: [0, 240], disposalTripMinutes: [0, 480], dumpFeeCents: [0, 100_000] });
  const crew = pick(raw.crew, defaults.crew, { leads: [0, 5], techs: [0, 10], hoursPerDay: [1, 16] });
  if (crew.leads + crew.techs < 1) crew.leads = 1;
  crew.leads = Math.round(crew.leads);
  crew.techs = Math.round(crew.techs);
  const pay = pick(raw.pay, defaults.pay, { p4pShare: [0, 1], leadWeight: [0.1, 10], minWageCents: [0, 20_000] });
  const ind = obj(raw.indirect);
  const indirect: IndirectSettings = {
    ...pick(raw.indirect, defaults.indirect, { ic90Cents: [0, 1e10], pm90Minutes: [1, 1e7] }),
    source: source(ind.source, defaults.indirect.source),
  };
  const cap = obj(raw.capacity);
  const capacity: CapacitySettings = {
    ...pick(raw.capacity, defaults.capacity, { bookedHours: [0, 100_000], availableHours: [1, 100_000], crews: [1, 20], workdaysPerWeek: [1, 7], windowWeeks: [1, 26] }),
    source: source(cap.source, defaults.capacity.source),
  };
  return { rates, conditions, logistics, travel, crew, pay, indirect, capacity, bands: readBands(raw.bands, defaults.bands) };
}

/** The capacity table, kept only when it climbs: each band's ceiling above the last, the last open. */
export function readBands(input: unknown, fallback: CapacityBand[] = DEFAULT_BANDS): CapacityBand[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 10) return fallback;
  const bands = input.map((b, i) => {
    const o = obj(b);
    const last = i === input.length - 1;
    return { below: last ? null : num(o.below, NaN, 0, 10), multiplier: num(o.multiplier, NaN, 0.5, 10) };
  });
  for (let i = 0; i < bands.length; i++) {
    if (!Number.isFinite(bands[i].multiplier)) return fallback;
    if (bands[i].below !== null && (!Number.isFinite(bands[i].below!) || (i > 0 && !(bands[i].below! > bands[i - 1].below!)))) return fallback;
  }
  return bands;
}

/** μ(U): the first band U is under, else the top one. */
export function capacityMultiplier(utilization: number, bands: CapacityBand[] = DEFAULT_BANDS): number {
  const u = Number.isFinite(utilization) ? Math.max(0, utilization) : 0;
  for (const b of bands) if (b.below !== null && u < b.below - 1e-12) return b.multiplier;
  return bands[bands.length - 1].multiplier;
}

/** "U < 60%", "60% ≤ U < 80%", "U ≥ 100%". */
export function bandLabel(bands: CapacityBand[], i: number): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const lo = i > 0 ? bands[i - 1].below : null;
  const hi = bands[i].below;
  if (lo == null && hi != null) return `U < ${pct(hi)}`;
  if (hi == null) return `U ≥ ${pct(lo ?? 0)}`;
  return `${pct(lo!)} ≤ U < ${pct(hi)}`;
}

export function rateByKey(vars: PricingVariables): Map<string, ProductionRate> {
  return new Map(vars.rates.map((r) => [r.key, r]));
}

/** The categories, in the workbook's order. */
export function rateCategories(rates: ProductionRate[]): string[] {
  return [...new Set(rates.map((r) => r.category))];
}

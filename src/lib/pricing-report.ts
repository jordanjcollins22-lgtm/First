/**
 * One project, priced: from each area's measurements, tasks and confirmed
 * conditions to the selling price, the materials to order and every
 * person's hours and pay. What the one-page report prints.
 *
 *   labour minutes  = quantity ÷ units per labour-minute × condition multipliers
 *   crew clock      = labour minutes ÷ crew size (the work is assumed to split evenly)
 *   PM̂              = crew clock + logistics + travel, rounded up to whole hours
 *   DĈ              = materials + disposal + delivery + subcontractors + rentals + permits + other
 *   IR              = IC₉₀ ÷ PM₉₀
 *   IĈ              = IR × PM̂
 *   Ĉ               = DĈ + IĈ
 *   U               = booked hours ÷ available hours
 *   P               = Ĉ × μ(U), rounded up to the dollar
 *
 * Crew pay is pay for performance: a share of the job's labour revenue,
 * taken as P − DĈ (what the job brings in that isn't passed-through direct
 * cost), split across the crew by hours worked, a lead's hour weighted above
 * a tech's. Nobody gets less than minimum wage for the hours they actually
 * work, so a job that runs over still pays at least that.
 *
 * Pure, so the arithmetic is tested without a database.
 */

import { billedHours } from "@/lib/gross-profit";
import { TONS_PER_YARD_OF_STONE } from "@/lib/material-suppliers";
import { rollUpMaterials, stagedYards, NO_SOURCES, type PricedMaterial, type PriceSources } from "@/lib/pricing-materials";
import {
  CONDITIONS,
  capacityMultiplier,
  conditionApplies,
  impliedMargin,
  rateByKey,
  type AreaConditions,
  type ConditionKey,
  type InputSource,
  type PricingVariables,
  type ProductionRate,
  type RateUnit,
} from "@/lib/pricing-variables";

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

export interface TaskInput {
  key: string;
  /** Typed by the office. Unset: worked out from the area's measurements where that is obvious. */
  qty?: number | null;
}

export interface AreaInput {
  id: string;
  name: string;
  /** Square feet of the area. */
  sf?: number | null;
  /** Linear feet: the bed edge, the run of a trench. */
  lf?: number | null;
  /** Depth of material going in, in inches, for mulch, soil and stone. */
  depthIn?: number | null;
  tasks: TaskInput[];
  /** Confirmed by the office. Unset conditions are the defaults. */
  conditions: AreaConditions;
  /** What Claude read off the photos, waiting for the office: never priced until copied into conditions and tasks. */
  suggested?: AreaSuggestion | null;
  /** The office has looked at the conditions (and any suggestion) and confirmed them. */
  confirmed?: boolean;
  /** Photos of the area: paths in the job-photos bucket. */
  photos?: string[];
  /** What the client said they want done here, when they said. */
  wants?: string | null;
}

export interface AreaSuggestion {
  conditions: AreaConditions;
  tasks: { key: string; qty: number | null; why: string }[];
  notes: string;
  at: string;
}

export interface DirectCostInput {
  /** Cents. */
  subcontractors: number;
  rentals: number;
  delivery: number;
  permits: number;
  other: number;
}

export interface ProjectInput {
  name: string;
  client?: string | null;
  address?: string | null;
  areas: AreaInput[];
  /** Unset: the variables' crew. */
  crew?: { leads: number; techs: number } | null;
  /** From the map; unset or null: the travel setting. */
  driveMinutesEachWay?: number | null;
  disposalTrips?: number;
  /** Items off the truck each day. Unset: the logistics defaults. */
  smallItems?: number | null;
  largeItems?: number | null;
  direct?: Partial<DirectCostInput>;
}

/** What the app knows about the indirect pool and capacity, where it knows anything. */
export interface AppFigures {
  ic90Cents: number | null;
  pm90Minutes: number | null;
  bookedHours: number | null;
  availableHours: number | null;
  notes: string[];
}

export const NO_APP_FIGURES: AppFigures = { ic90Cents: null, pm90Minutes: null, bookedHours: null, availableHours: null, notes: [] };

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

const DEFAULT_DEPTH: Record<string, number> = {
  "bed-installation.mulch-installation": 3,
  "bed-installation.topsoil-spreading": 2,
  "bed-installation.compost-spreading": 1,
  "bed-installation.decorative-rock-installation": 2,
  "bed-installation.drainage-stone-installation": 3,
};

/** A staple every 8 sq ft of fabric: seams and edges, the usual spacing. */
export const SF_PER_STAPLE = 8;

const fmt = (n: number) => (Math.abs(n - Math.round(n)) < 1e-9 ? Math.round(n).toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));

/**
 * A task's quantity: the one typed, else one worked out from the area where
 * it is obvious (SF from the area, LF from the edge, yards from area × depth,
 * tons of stone at 1.4 a yard, staples from the fabric). Null when it has to
 * be counted, like plants.
 */
export function deriveQuantity(rate: Pick<ProductionRate, "key" | "unit">, task: TaskInput, area: Pick<AreaInput, "sf" | "lf" | "depthIn" | "tasks">): { qty: number; how: string } | null {
  if (task.qty != null && Number.isFinite(task.qty) && task.qty > 0) return { qty: task.qty, how: "entered" };
  const sf = area.sf != null && area.sf > 0 ? area.sf : null;
  const lf = area.lf != null && area.lf > 0 ? area.lf : null;
  if (rate.key === "bed-installation.landscape-staples") {
    const fabric = area.tasks.find((t) => t.key === "bed-installation.landscape-fabric-installation");
    const fabricSf = fabric?.qty && fabric.qty > 0 ? fabric.qty : sf;
    return fabricSf ? { qty: Math.ceil(fabricSf / SF_PER_STAPLE), how: `${fmt(fabricSf)} SF ÷ ${SF_PER_STAPLE}` } : null;
  }
  if (rate.unit === "SF") return sf ? { qty: sf, how: "area" } : null;
  if (rate.unit === "LF") return lf ? { qty: lf, how: "edge" } : null;
  const depth = area.depthIn && area.depthIn > 0 ? area.depthIn : DEFAULT_DEPTH[rate.key];
  if (!sf || !depth) return null;
  const yards = (sf * depth) / 324;
  if (rate.unit === "CY" && DEFAULT_DEPTH[rate.key]) return { qty: round2(yards), how: `${fmt(sf)} SF × ${fmt(depth)} in ÷ 324` };
  if (rate.unit === "TON" && DEFAULT_DEPTH[rate.key]) return { qty: round2(yards * TONS_PER_YARD_OF_STONE), how: `${fmt(sf)} SF × ${fmt(depth)} in ÷ 324 × ${TONS_PER_YARD_OF_STONE} t` };
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The multipliers an area's conditions put on one task, and their product. */
export function conditionFactor(
  rate: Pick<ProductionRate, "key" | "category" | "unit">,
  conditions: AreaConditions,
  multipliers: PricingVariables["conditions"]
): { factor: number; applied: { key: ConditionKey; option: string; multiplier: number }[] } {
  const applied: { key: ConditionKey; option: string; multiplier: number }[] = [];
  let factor = 1;
  for (const def of CONDITIONS) {
    if (!conditionApplies(def.scope, rate)) continue;
    const option = conditions[def.key] ?? def.defaultOption;
    const m = multipliers[def.key]?.[option] ?? 1;
    if (m !== 1) applied.push({ key: def.key, option, multiplier: m });
    factor *= m;
  }
  return { factor, applied };
}

/** Labour minutes for one person: quantity ÷ units per labour-minute × the condition factor. */
export function labourMinutes(quantity: number, unitsPerLaborMinute: number, factor = 1): number {
  if (!(quantity > 0) || !(unitsPerLaborMinute > 0)) return 0;
  return (quantity / unitsPerLaborMinute) * factor;
}

export interface CrewMember {
  role: "lead" | "tech";
  label: string;
  hours: number;
  weight: number;
}

export interface MemberPay extends CrewMember {
  /** The member's share of the pool, at these hours. */
  shareCents: number;
  /** Minimum wage × hours. */
  floorCents: number;
  /** The larger of the two. */
  payCents: number;
  floorApplies: boolean;
  /** The hours at which the floor would start to pay more than the share: share ÷ minimum wage. */
  floorFromHours: number | null;
  /** Pay ÷ hours. */
  perHourCents: number;
}

/**
 * The pool split across the crew by weighted hours, each at least minimum
 * wage for the hours they work. With actual hours in, this is what each is
 * paid when the job runs over or under.
 */
export function p4pSplit(poolCents: number, crew: CrewMember[], minWageCents: number): MemberPay[] {
  const pool = Math.max(0, poolCents);
  const points = crew.reduce((s, m) => s + Math.max(0, m.hours) * Math.max(0, m.weight), 0);
  return crew.map((m) => {
    const hours = Math.max(0, m.hours);
    const shareCents = points > 0 ? Math.round((pool * hours * Math.max(0, m.weight)) / points) : 0;
    const floorCents = Math.round(hours * Math.max(0, minWageCents));
    const payCents = Math.max(shareCents, floorCents);
    return {
      ...m,
      hours,
      shareCents,
      floorCents,
      payCents,
      floorApplies: floorCents > shareCents,
      floorFromHours: minWageCents > 0 ? shareCents / minWageCents : null,
      perHourCents: hours > 0 ? Math.round(payCents / hours) : 0,
    };
  });
}

/** The crew as people: the leads, then the techs, everyone on the clock for the same hours. */
export function crewMembers(leads: number, techs: number, hours: number, leadWeight: number): CrewMember[] {
  return [
    ...Array.from({ length: leads }, (_, i) => ({ role: "lead" as const, label: leads > 1 ? `Lead ${i + 1}` : "Lead", hours, weight: leadWeight })),
    ...Array.from({ length: techs }, (_, i) => ({ role: "tech" as const, label: `Tech ${i + 1}`, hours, weight: 1 })),
  ];
}

/**
 * The fewest days the job fits in: each day has hoursPerDay on the clock,
 * and costs its setup, breakdown and unloading and the drive both ways;
 * the work and the one-off items fill what's left.
 */
export function daysFor(input: { onceMinutes: number; perDayMinutes: number; hoursPerDay: number }): number {
  const day = input.hoursPerDay * 60;
  if (!(input.onceMinutes > 0)) return 0;
  for (let d = 1; d <= 365; d++) if (input.onceMinutes + d * input.perDayMinutes <= d * day + 1e-9) return d;
  return 365;
}

/**
 * Elapsed project minutes from the crew's clock: each job's time entries
 * merged where they overlap, so two people on the same job for an hour is
 * an hour, not two.
 */
export function elapsedMinutes(entries: { jobId: string; start: number; end: number }[]): number {
  const byJob = new Map<string, { start: number; end: number }[]>();
  for (const e of entries) {
    if (!(e.end > e.start)) continue;
    const list = byJob.get(e.jobId) ?? [];
    list.push({ start: e.start, end: e.end });
    byJob.set(e.jobId, list);
  }
  let ms = 0;
  for (const list of byJob.values()) {
    list.sort((a, b) => a.start - b.start);
    let cur = { ...list[0] };
    for (const iv of list.slice(1)) {
      if (iv.start <= cur.end) cur.end = Math.max(cur.end, iv.end);
      else {
        ms += cur.end - cur.start;
        cur = { ...iv };
      }
    }
    ms += cur.end - cur.start;
  }
  return ms / 60_000;
}

/** IC₉₀, PM₉₀, booked and available hours: the app's where it has them and the variables say to use them, else as entered. */
export function resolvePool(vars: PricingVariables, app: AppFigures = NO_APP_FIGURES) {
  const useApp = vars.indirect.source === "app";
  const ic = useApp && app.ic90Cents != null && app.ic90Cents > 0 ? { v: app.ic90Cents, s: "app" as InputSource } : { v: vars.indirect.ic90Cents, s: "manual" as InputSource };
  const pm = useApp && app.pm90Minutes != null && app.pm90Minutes > 0 ? { v: app.pm90Minutes, s: "app" as InputSource } : { v: vars.indirect.pm90Minutes, s: "manual" as InputSource };
  const capApp = vars.capacity.source === "app";
  const booked = capApp && app.bookedHours != null ? { v: app.bookedHours, s: "app" as InputSource } : { v: vars.capacity.bookedHours, s: "manual" as InputSource };
  const available = capApp && app.availableHours != null && app.availableHours > 0 ? { v: app.availableHours, s: "app" as InputSource } : { v: vars.capacity.availableHours, s: "manual" as InputSource };
  return {
    ic90Cents: ic.v,
    ic90Source: ic.s,
    pm90Minutes: pm.v,
    pm90Source: pm.s,
    bookedHours: booked.v,
    bookedSource: booked.s,
    availableHours: available.v,
    availableSource: available.s,
  };
}

/* ------------------------------------------------------------------ */
/* The report                                                          */
/* ------------------------------------------------------------------ */

export interface TaskRow {
  key: string;
  category: string;
  task: string;
  unit: RateUnit;
  qty: number | null;
  how: string | null;
  unitsPerLaborMinute: number;
  factor: number;
  applied: { key: ConditionKey; option: string; multiplier: number }[];
  /** One person's labour minutes. */
  labourMinutes: number;
  labourHours: number;
}

export interface AreaRow {
  id: string;
  name: string;
  sf: number | null;
  lf: number | null;
  conditions: Record<ConditionKey, string>;
  confirmed: boolean;
  tasks: TaskRow[];
  labourHours: number;
}

export interface DirectCostRow {
  key: "materials" | "disposal" | "delivery" | "subcontractors" | "rentals" | "permits" | "other";
  label: string;
  cents: number;
  detail?: string;
}

export interface PricingReport {
  name: string;
  client: string | null;
  address: string | null;
  areas: AreaRow[];
  materials: PricedMaterial[];
  /** Materials with no price: left out of DĈ, and the price is short by them. */
  priceNeeded: string[];

  crew: { leads: number; techs: number; size: number };
  /** Minutes on the clock, whole crew. */
  time: {
    workClockMinutes: number;
    stagingClockMinutes: number;
    setupBreakdownMinutes: number;
    unloadingMinutes: number;
    walkthroughInspectionMinutes: number;
    driveMinutes: number;
    pickupMinutes: number;
    disposalMinutes: number;
    /** All of it, before rounding. */
    clockMinutes: number;
    days: number;
    /** On the clock per person, rounded up to whole hours: PM̂ in hours. */
    billedHours: number;
    hoursPerDay: number;
    driveMinutesEachWay: number;
    driveAssumed: boolean;
  };
  /** One person's labour hours on the tasks, all areas. */
  taskLabourHours: number;

  direct: DirectCostRow[];
  dcCents: number;
  pool: ReturnType<typeof resolvePool>;
  /** Cents an elapsed project minute. */
  irCents: number;
  pmMinutes: number;
  icCents: number;
  costCents: number;
  utilization: number;
  multiplier: number;
  impliedMargin: number;
  priceCents: number;
  /** P − DĈ. */
  labourRevenueCents: number;
  /** P − Ĉ. */
  grossProfitCents: number;
  p4p: { share: number; poolCents: number; minWageCents: number; leadWeight: number; people: MemberPay[]; payCents: number };
  warnings: string[];
}

export function priceProject(project: ProjectInput, vars: PricingVariables, sources: PriceSources = NO_SOURCES, app: AppFigures = NO_APP_FIGURES): PricingReport {
  const rates = rateByKey(vars);
  const warnings: string[] = [];

  const areas: AreaRow[] = project.areas.map((area) => {
    const conditions = Object.fromEntries(CONDITIONS.map((c) => [c.key, area.conditions[c.key] ?? c.defaultOption])) as Record<ConditionKey, string>;
    const tasks: TaskRow[] = area.tasks.flatMap((t) => {
      const rate = rates.get(t.key);
      if (!rate) return [];
      const q = deriveQuantity(rate, t, area);
      const { factor, applied } = conditionFactor(rate, conditions, vars.conditions);
      const minutes = q ? labourMinutes(q.qty, rate.unitsPerLaborMinute, factor) : 0;
      if (!q) warnings.push(`${area.name}: ${rate.task} has no quantity.`);
      return [
        {
          key: rate.key,
          category: rate.category,
          task: rate.task,
          unit: rate.unit,
          qty: q?.qty ?? null,
          how: q?.how ?? null,
          unitsPerLaborMinute: rate.unitsPerLaborMinute,
          factor,
          applied,
          labourMinutes: minutes,
          labourHours: minutes / 60,
        },
      ];
    });
    if (!area.confirmed) warnings.push(`${area.name}: conditions not confirmed yet.`);
    return { id: area.id, name: area.name, sf: area.sf ?? null, lf: area.lf ?? null, conditions, confirmed: Boolean(area.confirmed), tasks, labourHours: tasks.reduce((s, t) => s + t.labourHours, 0) };
  });

  const materials = rollUpMaterials(
    areas.flatMap((a) => a.tasks.map((t) => ({ area: a.name, task: t.key, quantity: t.qty ?? 0, unit: t.unit }))),
    sources
  );
  const priceNeeded = materials.filter((m) => m.costCents == null).map((m) => m.name);
  if (priceNeeded.length) warnings.push(`Price needed for ${priceNeeded.join(", ")}: left out of the price.`);

  // The crew and the clock.
  const leads = Math.max(0, Math.round(project.crew?.leads ?? vars.crew.leads));
  const techs = Math.max(0, Math.round(project.crew?.techs ?? vars.crew.techs));
  const size = Math.max(1, leads + techs);
  const L = vars.logistics;
  const taskLabourMinutes = areas.reduce((s, a) => s + a.tasks.reduce((t, x) => t + x.labourMinutes, 0), 0);
  const workClockMinutes = taskLabourMinutes / size;
  const stagingClockMinutes = (stagedYards(materials) * L.stagingPerCy) / size;
  const smallItems = project.smallItems ?? L.smallItemsPerDay;
  const largeItems = project.largeItems ?? L.largeItemsPerDay;
  const perDayLogistics = L.setup + L.breakdown + smallItems * L.smallUnload + largeItems * L.largeUnload;
  const driveAssumed = project.driveMinutesEachWay == null || !(project.driveMinutesEachWay >= 0);
  const driveEachWay = driveAssumed ? vars.travel.driveMinutesEachWay : project.driveMinutesEachWay!;
  const pickupMinutes = materials.length > 0 ? vars.travel.pickupMinutes : 0;
  const trips = Math.max(0, Math.round(project.disposalTrips ?? 0));
  const disposalMinutes = trips * vars.travel.disposalTripMinutes;
  const walkthroughInspectionMinutes = L.walkthrough + L.inspection;
  const working = workClockMinutes > 0;
  const onceMinutes = working ? workClockMinutes + stagingClockMinutes + walkthroughInspectionMinutes + pickupMinutes + disposalMinutes : 0;
  const days = daysFor({ onceMinutes, perDayMinutes: perDayLogistics + driveEachWay * 2, hoursPerDay: vars.crew.hoursPerDay });
  const setupBreakdownMinutes = days * (L.setup + L.breakdown);
  const unloadingMinutes = days * (smallItems * L.smallUnload + largeItems * L.largeUnload);
  const driveMinutes = days * driveEachWay * 2;
  const clockMinutes = working ? onceMinutes + setupBreakdownMinutes + unloadingMinutes + driveMinutes : 0;
  const billed = working ? billedHours(clockMinutes / 60) : 0;
  if (driveAssumed && working) warnings.push(`Drive assumed at ${driveEachWay} minutes each way.`);

  // Direct costs.
  const d = project.direct ?? {};
  const materialsCents = materials.reduce((s, m) => s + (m.costCents ?? 0), 0);
  const direct: DirectCostRow[] = [
    { key: "materials", label: "Materials and supplies", cents: materialsCents, detail: priceNeeded.length ? `${priceNeeded.length} without a price` : undefined },
    { key: "disposal", label: "Disposal and hauling", cents: trips * vars.travel.dumpFeeCents, detail: trips ? `${trips} load${trips === 1 ? "" : "s"} × $${(vars.travel.dumpFeeCents / 100).toFixed(0)}` : undefined },
    { key: "delivery", label: "Delivery and freight", cents: Math.max(0, Math.round(d.delivery ?? 0)) },
    { key: "subcontractors", label: "Subcontractors", cents: Math.max(0, Math.round(d.subcontractors ?? 0)) },
    { key: "rentals", label: "Equipment and vehicle rentals", cents: Math.max(0, Math.round(d.rentals ?? 0)) },
    { key: "permits", label: "Permits, inspections, specialty", cents: Math.max(0, Math.round(d.permits ?? 0)) },
    { key: "other", label: "Other job-specific", cents: Math.max(0, Math.round(d.other ?? 0)) },
  ];
  const dcCents = direct.reduce((s, r) => s + r.cents, 0);

  // Indirect, capacity, price.
  const pool = resolvePool(vars, app);
  if (pool.ic90Source === "manual" || pool.pm90Source === "manual") warnings.push("Indirect pool (IC₉₀ / PM₉₀) is entered by hand.");
  const irCents = pool.pm90Minutes > 0 ? pool.ic90Cents / pool.pm90Minutes : 0;
  const pmMinutes = billed * 60;
  const icCents = Math.round(irCents * pmMinutes);
  const costCents = dcCents + icCents;
  const utilization = pool.availableHours > 0 ? pool.bookedHours / pool.availableHours : 0;
  const multiplier = capacityMultiplier(utilization, vars.bands);
  const priceCents = costCents > 0 ? Math.ceil((costCents * multiplier) / 100 - 1e-9) * 100 : 0;
  const labourRevenueCents = Math.max(0, priceCents - dcCents);
  const poolCents = Math.round(labourRevenueCents * vars.pay.p4pShare);
  const people = p4pSplit(poolCents, crewMembers(leads, techs, billed, vars.pay.leadWeight), vars.pay.minWageCents);
  if (people.some((p) => p.floorApplies)) warnings.push("Minimum wage floor applies at the estimated hours: the P4P share is under minimum wage.");

  return {
    name: project.name,
    client: project.client ?? null,
    address: project.address ?? null,
    areas,
    materials,
    priceNeeded,
    crew: { leads, techs, size },
    time: {
      workClockMinutes,
      stagingClockMinutes,
      setupBreakdownMinutes,
      unloadingMinutes,
      walkthroughInspectionMinutes: working ? walkthroughInspectionMinutes : 0,
      driveMinutes,
      pickupMinutes: working ? pickupMinutes : 0,
      disposalMinutes: working ? disposalMinutes : 0,
      clockMinutes,
      days,
      billedHours: billed,
      hoursPerDay: days > 0 ? billed / days : 0,
      driveMinutesEachWay: driveEachWay,
      driveAssumed,
    },
    taskLabourHours: taskLabourMinutes / 60,
    direct,
    dcCents,
    pool,
    irCents,
    pmMinutes,
    icCents,
    costCents,
    utilization,
    multiplier,
    impliedMargin: impliedMargin(multiplier),
    priceCents,
    labourRevenueCents,
    grossProfitCents: priceCents - costCents,
    p4p: { share: vars.pay.p4pShare, poolCents, minWageCents: vars.pay.minWageCents, leadWeight: vars.pay.leadWeight, people, payCents: people.reduce((s, p) => s + p.payCents, 0) },
    warnings,
  };
}

/**
 * Stage 3 of the job pipeline: engineering calculations.
 *
 * Takes the Stage 1 scope (what this property needs) and the Stage 2
 * library (what the company knows) and works out, per work item: the
 * quantity in the rate's unit (sqft of mulch -> cubic yards at the standard
 * depth), the production rate that fits the item's measurements, and the
 * labor minutes. Totals by zone and project, and lists each shared resource
 * once. The result names the library version and production models it used.
 *
 * Deterministic arithmetic only. Anything missing is named, never guessed.
 */

import type { Project, WorkItem } from "@/lib/evaluation-line-items";
import { UNITS } from "@/lib/evaluation-line-items";
import { findOperation, indexLibrary, isObj, pickRate, type LibRate, type LibResource, type Library } from "@/lib/resource-library";

type Unit = (typeof UNITS)[number];

/**
 * The quantity in the rate's unit, using the operation's standards and the
 * material's physical properties.
 */
export function toRateQuantity(
  quantity: number,
  from: Unit,
  to: Unit,
  standards: Record<string, number>,
  properties: Record<string, unknown>,
): { quantity: number | null; missing: string[] } {
  if (from === to) return { quantity, missing: [] };
  const physical = isObj(properties.physical) ? properties.physical : {};
  const density = typeof physical.density_ton_per_cuyd === "number" ? physical.density_ton_per_cuyd : null;
  const depth = standards.depth_in ?? null;
  const missing: string[] = [];
  const needDepth = () => missing.includes("standards.depth_in") || missing.push("standards.depth_in");
  const needDensity = () => missing.includes("physical.density_ton_per_cuyd") || missing.push("physical.density_ton_per_cuyd");

  const area = from === "sqft" || from === "sqyd";
  const toArea = to === "sqft" || to === "sqyd";
  if (!((area || from === "cuyd" || from === "ton") && (toArea || to === "cuyd" || to === "ton"))) {
    return { quantity: null, missing: [`conversion ${from} to ${to}`] };
  }
  if ((area || toArea) && depth == null) needDepth();
  if ((from === "ton" || to === "ton") && density == null) needDensity();
  if (missing.length) return { quantity: null, missing };

  // Everything through cubic yards. sqft × inches ÷ 324 = cubic yards.
  const sqft = (q: number) => (from === "sqyd" ? q * 9 : q);
  const cuyd = area ? (sqft(quantity) * depth!) / 324 : from === "ton" ? quantity / density! : quantity;
  if (to === "cuyd") return { quantity: cuyd, missing };
  if (to === "ton") return { quantity: cuyd * density!, missing };
  const outSqft = (cuyd * 324) / depth!;
  return { quantity: to === "sqyd" ? outSqft / 9 : outSqft, missing };
}

export interface ItemCalc {
  item_id: number | undefined;
  zone_id: number;
  /** Production model used, e.g. "shrub_remove". */
  model_id: string | null;
  /** Null until everything needed is known. */
  minutes: number | null;
  rate_quantity: number | null;
  rate_unit: Unit | null;
  rate: LibRate | null;
  /** Library values or measurements still needed, by name. */
  missing: string[];
  /** The rate isn't verified yet, or a measurement it used wasn't measured. */
  provisional: boolean;
}

export function calculateItem(lib: Library, zoneId: number, item: WorkItem): ItemCalc {
  const base = { item_id: item.item_id, zone_id: zoneId, model_id: null, minutes: null, rate_quantity: null, rate_unit: null, rate: null, provisional: true };
  const found = findOperation(lib, item);
  if (!found) {
    return { ...base, missing: [`library entry for ${item.operation} ${item.material}${item.subtype ? ` ${item.subtype}` : ""}`] };
  }
  const { op, properties } = found;
  const missing: string[] = [];
  if (item.unit !== op.unit) missing.push(`quantity in ${op.unit} (got ${item.unit})`);

  const { rate, needs } = pickRate(op, item);
  missing.push(...needs.map((k) => `measurement ${k}`));
  if (!rate) missing.push("production rate");

  const conv = item.unit === op.unit ? toRateQuantity(item.quantity, op.unit, op.rate_unit, op.standards, properties) : { quantity: null, missing: [] };
  missing.push(...conv.missing);

  const used = rate ? Object.keys(rate.when) : [];
  const provisional = !rate || rate.status !== "verified" || used.some((k) => item.measurements?.[k]?.source !== "measured");
  const minutes = rate && conv.quantity != null && missing.length === 0 ? conv.quantity * rate.minutes_per_unit : null;
  return { ...base, model_id: op.model_id, minutes, rate_quantity: conv.quantity, rate_unit: op.rate_unit, rate, missing, provisional };
}

export interface ProjectCalc {
  project_id: number | string;
  /** The resource library snapshot these numbers came from. */
  library_version: number;
  items: ItemCalc[];
  /** Minutes per zone; null for a zone with anything missing. */
  zones: { zone_id: number; minutes: number | null }[];
  /** Null while anything is missing. */
  minutes: number | null;
  /** Each shared resource the project needs, once, however many operations use it. */
  resources: LibResource[];
  missing: { item_id: number | undefined; zone_id: number; what: string }[];
}

export function calculateProject(lib: Library, project: Project): ProjectCalc {
  const ix = indexLibrary(lib);
  const items = project.zones.flatMap((z) => z.work_items.map((i) => calculateItem(lib, z.zone_id, i)));
  const zones = project.zones.map((z) => {
    const mine = items.filter((i) => i.zone_id === z.zone_id);
    return { zone_id: z.zone_id, minutes: mine.every((i) => i.minutes != null) ? sum(mine.map((i) => i.minutes!)) : null };
  });
  const ids = new Set(project.zones.flatMap((z) => z.work_items.flatMap((i) => findOperation(lib, i)?.op.needs.map((n) => n.resource_id) ?? [])));
  return {
    project_id: project.project_id,
    library_version: lib.version,
    items,
    zones,
    minutes: zones.every((z) => z.minutes != null) ? sum(zones.map((z) => z.minutes!)) : null,
    resources: [...ids].map((id) => ix.resources.get(id)!).filter(Boolean),
    missing: items.flatMap((i) => i.missing.map((what) => ({ item_id: i.item_id, zone_id: i.zone_id, what }))),
  };
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

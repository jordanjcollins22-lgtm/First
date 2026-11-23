/**
 * The resource library's task list: every material subtype and shared
 * resource, with what it is still missing before a project using it can be
 * calculated, verified and written up without anyone filling a gap by hand.
 *
 * For a subtype that is: its properties (size, roots, soil needs, weight,
 * price ...), its complications (thorns, toxic sap, regrowth), and for each
 * operation it should support, whether there is a production model, whether
 * its rates exist and are verified, and whether the standards it needs are
 * set. Pure, so the list can be rebuilt from any library snapshot.
 */

import { OPERATIONS } from "@/lib/evaluation-line-items";
import { isObj, operationFor, type Library } from "@/lib/resource-library";

type Op = (typeof OPERATIONS)[number];

/** The properties each material's subtypes need, as dotted paths. */
export const REQUIRED_PROPERTIES: Record<string, string[]> = {
  plant: [
    "physical.mature_height_ft",
    "physical.mature_spread_ft",
    "biological.growth_rate",
    "biological.root_system",
    "biological.sun",
    "biological.moisture",
    "chemical.soil_ph_min",
    "chemical.soil_ph_max",
    "biological.hardiness_zones",
    "biological.complications",
    "financial.price_cents",
  ],
  mulch: ["physical.density_ton_per_cuyd", "physical.decomposition_years", "financial.price_cents_per_cuyd"],
  stone: ["physical.density_ton_per_cuyd", "physical.size_range_in", "financial.price_cents_per_ton"],
  soil: ["physical.density_ton_per_cuyd", "chemical.ph", "financial.price_cents_per_cuyd"],
  turf: ["biological.sun", "biological.traffic_tolerance", "operational.seed_lb_per_1000_sqft", "financial.price_cents"],
  hardscape: ["physical.unit_weight_lb", "operational.base_requirements", "financial.price_cents_per_unit"],
  edging: ["physical.material", "financial.price_cents_per_lnft"],
  drainage: ["physical.size", "financial.price_cents_per_unit"],
  debris: ["physical.density_ton_per_cuyd", "financial.disposal_cents_per_cuyd"],
};

/** The operations each material's subtypes should support. */
export const EXPECTED_OPERATIONS: Record<string, Op[]> = {
  plant: ["install", "remove", "maintain"],
  mulch: ["install", "remove", "maintain"],
  stone: ["install", "remove"],
  soil: ["install"],
  turf: ["install", "remove", "maintain"],
  hardscape: ["install", "remove", "maintain"],
  edging: ["install", "remove"],
  drainage: ["install", "maintain"],
  debris: ["remove"],
};

/** Plain words for a property path, for the task list. */
const WORDS: Record<string, string> = {
  "physical.mature_height_ft": "mature height",
  "physical.mature_spread_ft": "mature spread",
  "biological.growth_rate": "growth rate",
  "biological.root_system": "root system",
  "biological.sun": "sun needs",
  "biological.moisture": "moisture needs",
  "chemical.soil_ph_min": "lowest soil pH",
  "chemical.soil_ph_max": "highest soil pH",
  "biological.hardiness_zones": "hardiness zones",
  "biological.complications": "complications (thorns, toxic, regrowth, near structures ...)",
  "financial.price_cents": "price",
  "physical.density_ton_per_cuyd": "weight per cubic yard",
  "physical.decomposition_years": "how long it lasts",
  "financial.price_cents_per_cuyd": "price per cubic yard",
  "physical.size_range_in": "stone size",
  "financial.price_cents_per_ton": "price per ton",
  "chemical.ph": "pH",
  "biological.traffic_tolerance": "foot traffic tolerance",
  "operational.seed_lb_per_1000_sqft": "seed rate per 1,000 sq ft",
  "physical.unit_weight_lb": "weight per unit",
  "operational.base_requirements": "base requirements",
  "financial.price_cents_per_unit": "price per unit",
  "physical.material": "what it's made of",
  "financial.price_cents_per_lnft": "price per linear foot",
  "physical.size": "size",
  "financial.disposal_cents_per_cuyd": "disposal cost per cubic yard",
};

export interface GapRow {
  material: string;
  subtype_id: number;
  subtype: string;
  name: string;
  kind: string | null;
  origin: string | null;
  /** Each thing still to fill in, in plain words. */
  missing: string[];
}

export interface ResourceGapRow {
  resource_id: number;
  resource: string;
  name: string;
  missing: string[];
}

function has(obj: Record<string, unknown>, path: string): boolean {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (!isObj(cur) || !(part in cur)) return false;
    cur = cur[part];
  }
  return cur !== null && cur !== undefined && cur !== "";
}

export function libraryGaps(lib: Library): { subtypes: GapRow[]; resources: ResourceGapRow[] } {
  const subtypes: GapRow[] = [];
  for (const material of lib.materials) {
    const required = REQUIRED_PROPERTIES[material.key] ?? [];
    const ops = EXPECTED_OPERATIONS[material.key] ?? [];
    for (const subtype of material.subtypes) {
      const missing: string[] = [];
      const merged = { ...material.properties, ...subtype.properties };
      for (const path of required) if (!has(merged, path)) missing.push(WORDS[path] ?? path);

      for (const operation of ops) {
        const found = operationFor(material, subtype, operation);
        if (!found) {
          missing.push(`${operation}: no production model`);
          continue;
        }
        const { op } = found;
        if (op.rates.length === 0) missing.push(`${operation}: no production rate`);
        else if (op.rates.some((r) => r.status !== "verified")) missing.push(`${operation}: rates not verified`);
        const area = op.unit === "sqft" || op.unit === "sqyd";
        const volume = op.rate_unit === "cuyd" || op.rate_unit === "ton";
        if (area && volume && op.standards.depth_in == null) missing.push(`${operation}: standard depth`);
        if (!op.scope_template) missing.push(`${operation}: proposal wording`);
      }
      if (missing.length) {
        const kind = typeof subtype.properties.kind === "string" ? subtype.properties.kind : null;
        const origin = typeof subtype.properties.origin === "string" ? subtype.properties.origin : null;
        subtypes.push({ material: material.key, subtype_id: subtype.id, subtype: subtype.key, name: subtype.name, kind, origin, missing });
      }
    }
  }
  const resources = lib.resources
    .map((r) => ({
      resource_id: r.id,
      resource: r.key,
      name: r.name,
      missing: Object.keys(r.costs).length === 0 ? ["costs (ARC and OCS, or rate)"] : [],
    }))
    .filter((r) => r.missing.length > 0);
  return { subtypes, resources };
}

/** The task list as CSV, one row per subtype or resource. */
export function gapsCsv(lib: Library): string {
  const { subtypes, resources } = libraryGaps(lib);
  const q = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const lines = [["id", "material", "key", "name", "kind", "origin", "missing_count", "missing"].join(",")];
  for (const r of subtypes) {
    lines.push([r.subtype_id, r.material, r.subtype, r.name, r.kind, r.origin, r.missing.length, r.missing.join("; ")].map(q).join(","));
  }
  for (const r of resources) {
    lines.push([r.resource_id, "resource", r.resource, r.name, "", "", r.missing.length, r.missing.join("; ")].map(q).join(","));
  }
  return lines.join("\n") + "\n";
}

/**
 * Stage 2 of the job pipeline: the resource properties library, and
 * resources.msgpack, the file it is handed on in.
 *
 * Stage 1 (evaluation-line-items.ts) says what one project needs. This is
 * what the company knows, reused by every project:
 *
 *   Material -> Subtype -> Operation -> rates, standards, what to measure,
 *                                       and the shared resources it needs
 *
 * A work item finds its operation by operation + material + subtype. An
 * operation with subtype null covers every subtype that has none of its own,
 * so "remove a plant" is written once. Shared resources (a shovel, the dump
 * trailer) are defined once in `resources` and referenced by key.
 *
 * The functions here are the first steps of the calculation (section 8 of
 * the architecture): find the operation, pick the rate from the item's
 * measurements, convert the quantity to the rate's unit using company
 * standards, and work out labor minutes. Anything missing is named, never
 * guessed. Pure and deterministic, no AI. Tables: 0392_resource_library.sql.
 */

import { decode, encode } from "@msgpack/msgpack";
import { z } from "zod";

import { OPERATIONS, UNITS, toKey, type Project, type WorkItem } from "@/lib/evaluation-line-items";

export const STAGE_2 = 2;
export const STAGE_2_SCHEMA_VERSION = 1;

const keyStr = z.string().transform(toKey).pipe(z.string().min(1));
const props = z.record(z.string(), z.unknown()).default({});
const unit = z.enum(UNITS);

const rateSchema = z.object({
  /** Measurements this rate is for, e.g. { size_class: "large" }. {} is the fallback. */
  when: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  minutes_per_unit: z.number().finite().nonnegative(),
  source: z.string().optional(),
  status: z.enum(["provisional", "verified"]).default("provisional"),
});

const needSchema = z.object({
  /** Key of a shared resource. */
  resource: keyStr,
  amount: z.number().nonnegative().default(1),
  per: z.enum(["job", "unit", "labor_hour"]).default("job"),
});

const measureSchema = z.object({
  key: keyStr,
  label: z.string().optional(),
  options: z.array(z.string()).optional(),
  unit: z.string().optional(),
  /** What to photograph or collect for it. */
  evidence: z.string().optional(),
});

const operationSchema = z.object({
  operation: z.enum(OPERATIONS),
  /** Null: every subtype of the material without its own entry. */
  subtype: keyStr.nullable().default(null),
  /** Unit the evaluator's quantity comes in. */
  unit,
  /** Unit the rate is per. Same as unit unless the work is rated differently. */
  rate_unit: unit,
  /** Company standards never asked of the evaluator, e.g. { depth_in: 3 }. */
  standards: z.record(z.string(), z.number()).default({}),
  measure: z.array(measureSchema).default([]),
  /** "{qty}", "{unit}" and "{subtype}" are filled in from the work item. */
  scope_text: z.string().optional(),
  rates: z.array(rateSchema).default([]),
  needs: z.array(needSchema).default([]),
  properties: props,
});

const subtypeSchema = z.object({ key: keyStr, name: z.string(), properties: props });

const materialSchema = z.object({
  key: keyStr,
  name: z.string(),
  properties: props,
  subtypes: z.array(subtypeSchema).default([]),
  operations: z.array(operationSchema).default([]),
});

const resourceSchema = z.object({
  key: keyStr,
  kind: z.enum(["tool", "equipment", "labor", "consumable", "disposal", "vehicle"]),
  name: z.string(),
  properties: props,
  costs: z.record(z.string(), z.number()).default({}),
});

export const librarySchema = z
  .object({
    version: z.number().int().positive(),
    materials: z.array(materialSchema),
    resources: z.array(resourceSchema).default([]),
  })
  .superRefine((lib, ctx) => {
    const resources = new Set(lib.resources.map((r) => r.key));
    if (resources.size !== lib.resources.length) ctx.addIssue({ code: "custom", message: "A resource is defined twice" });
    for (const m of lib.materials) {
      const subtypes = new Set(m.subtypes.map((s) => s.key));
      const seen = new Set<string>();
      for (const op of m.operations) {
        const id = `${op.operation}/${op.subtype ?? "*"}`;
        if (seen.has(id)) ctx.addIssue({ code: "custom", message: `${m.key}: ${id} is defined twice` });
        seen.add(id);
        if (op.subtype && !subtypes.has(op.subtype)) {
          ctx.addIssue({ code: "custom", message: `${m.key}: no subtype ${op.subtype}` });
        }
        for (const n of op.needs) {
          if (!resources.has(n.resource)) ctx.addIssue({ code: "custom", message: `${m.key} ${id} needs unknown resource ${n.resource}` });
        }
      }
    }
  });

export type Library = z.output<typeof librarySchema>;
export type LibraryInput = z.input<typeof librarySchema>;
export type LibMaterial = z.output<typeof materialSchema>;
export type LibOperation = z.output<typeof operationSchema>;
export type LibRate = z.output<typeof rateSchema>;
export type LibResource = z.output<typeof resourceSchema>;

export interface Stage2File extends Library {
  stage: typeof STAGE_2;
  schema_version: number;
}

export function parseLibrary(input: unknown): Library {
  return librarySchema.parse(input);
}

export function packLibrary(input: LibraryInput): Uint8Array {
  const file: Stage2File = { stage: STAGE_2, schema_version: STAGE_2_SCHEMA_VERSION, ...parseLibrary(input) };
  return encode(file);
}

export function unpackLibrary(bytes: Uint8Array): Stage2File {
  const raw = decode(bytes) as Partial<Stage2File> | null;
  if (!raw || typeof raw !== "object" || raw.stage !== STAGE_2) throw new Error("Not a stage 2 resource library file");
  if (raw.schema_version !== STAGE_2_SCHEMA_VERSION) {
    throw new Error(`Unknown resource library version ${String(raw.schema_version)}`);
  }
  return { stage: STAGE_2, schema_version: raw.schema_version, ...parseLibrary(raw) };
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export interface Resolved {
  material: LibMaterial;
  /** Null when the item names no subtype, or one the library doesn't list. */
  subtype: z.output<typeof subtypeSchema> | null;
  op: LibOperation;
  /** Material properties with the subtype's laid over them. */
  properties: Record<string, unknown>;
}

/**
 * The library entry for a work item: the subtype's own operation if it has
 * one, otherwise the material's. Null when the library doesn't cover it.
 */
export function findOperation(lib: Library, item: Pick<WorkItem, "operation" | "material" | "subtype">): Resolved | null {
  const material = lib.materials.find((m) => m.key === item.material);
  if (!material) return null;
  const subtype = item.subtype ? (material.subtypes.find((s) => s.key === item.subtype) ?? null) : null;
  const op =
    (subtype && material.operations.find((o) => o.operation === item.operation && o.subtype === subtype.key)) ||
    material.operations.find((o) => o.operation === item.operation && o.subtype === null);
  if (!op) return null;
  return { material, subtype, op, properties: mergeProps(material.properties, subtype?.properties ?? {}) };
}

function mergeProps(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = isObj(b) && isObj(v) ? mergeProps(b, v) : v;
  }
  return out;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The rate for a work item: the one whose conditions all match the item's
 * measurements, the most specific first. When the operation's rates depend
 * on a measurement the item doesn't have, that measurement is named in
 * `needs` so the evaluator can be asked for it.
 */
export function pickRate(op: LibOperation, item: Pick<WorkItem, "measurements">): { rate: LibRate | null; needs: string[] } {
  const m = item.measurements ?? {};
  const matches = op.rates
    .filter((r) => Object.entries(r.when).every(([k, v]) => m[k] !== undefined && m[k].value === v))
    .sort((a, b) => Object.keys(b.when).length - Object.keys(a.when).length);
  const asked = new Set(op.rates.flatMap((r) => Object.keys(r.when)));
  const needs = [...asked].filter((k) => m[k] === undefined);
  return { rate: matches[0] ?? null, needs };
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/**
 * The work item's quantity in the rate's unit, using the operation's
 * standards and the material's physical properties. Names what's missing
 * rather than guessing it.
 */
export function toRateQuantity(
  quantity: number,
  from: (typeof UNITS)[number],
  to: (typeof UNITS)[number],
  standards: Record<string, number>,
  properties: Record<string, unknown>,
): { quantity: number | null; missing: string[] } {
  if (from === to) return { quantity, missing: [] };
  const physical = isObj(properties.physical) ? properties.physical : {};
  const density = typeof physical.density_ton_per_cuyd === "number" ? physical.density_ton_per_cuyd : null;
  const depth = standards.depth_in ?? null;
  const missing: string[] = [];

  let cuyd: number | null = null;
  if (from === "cuyd") cuyd = quantity;
  else if (from === "sqft" || from === "sqyd") {
    if (depth == null) missing.push("standards.depth_in");
    else cuyd = ((from === "sqyd" ? quantity * 9 : quantity) * depth) / 12 / 27;
  } else if (from === "ton") {
    if (density == null) missing.push("physical.density_ton_per_cuyd");
    else cuyd = quantity / density;
  } else {
    return { quantity: null, missing: [`conversion ${from} to ${to}`] };
  }
  if (cuyd == null) {
    // Name everything still needed, not just the first gap.
    if (to === "ton" && density == null && !missing.includes("physical.density_ton_per_cuyd")) {
      missing.push("physical.density_ton_per_cuyd");
    }
    return { quantity: null, missing };
  }

  if (to === "cuyd") return { quantity: cuyd, missing };
  if (to === "ton") {
    if (density == null) return { quantity: null, missing: [...missing, "physical.density_ton_per_cuyd"] };
    return { quantity: cuyd * density, missing };
  }
  if (to === "sqft" || to === "sqyd") {
    if (depth == null) return { quantity: null, missing: [...missing, "standards.depth_in"] };
    const sqft = (cuyd * 27 * 12) / depth;
    return { quantity: to === "sqyd" ? sqft / 9 : sqft, missing };
  }
  return { quantity: null, missing: [`conversion ${from} to ${to}`] };
}

// ---------------------------------------------------------------------------
// Labor for one work item, and for the project
// ---------------------------------------------------------------------------

export interface ItemLabor {
  item_id: number | undefined;
  zone_id: number;
  /** Null until everything needed is known. */
  minutes: number | null;
  rate_quantity: number | null;
  rate_unit: (typeof UNITS)[number] | null;
  rate: LibRate | null;
  /** Library values or measurements still needed, by name. */
  missing: string[];
  /** The rate or a measurement it used is not yet verified or not measured. */
  provisional: boolean;
}

export function itemLabor(lib: Library, zoneId: number, item: WorkItem): ItemLabor {
  const base = { item_id: item.item_id, zone_id: zoneId, minutes: null, rate_quantity: null, rate_unit: null, rate: null, provisional: true };
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

  const conv = item.unit === op.unit
    ? toRateQuantity(item.quantity, op.unit, op.rate_unit, op.standards, properties)
    : { quantity: null, missing: [] };
  missing.push(...conv.missing);

  const used = rate ? Object.keys(rate.when) : [];
  const provisional = !rate || rate.status !== "verified" || used.some((k) => item.measurements?.[k]?.source !== "measured");
  const minutes = rate && conv.quantity != null && missing.length === 0 ? conv.quantity * rate.minutes_per_unit : null;
  return { ...base, minutes, rate_quantity: conv.quantity, rate_unit: op.rate_unit, rate, missing, provisional };
}

export interface ProjectLabor {
  items: ItemLabor[];
  /** Minutes per zone; null for a zone with anything missing. */
  zones: { zone_id: number; minutes: number | null }[];
  /** Null while anything is missing. */
  minutes: number | null;
  /** Each shared resource the project needs, once, however many operations use it. */
  resources: LibResource[];
  missing: { item_id: number | undefined; zone_id: number; what: string }[];
}

export function projectLabor(lib: Library, project: Project): ProjectLabor {
  const items = project.zones.flatMap((z) => z.work_items.map((i) => itemLabor(lib, z.zone_id, i)));
  const zones = project.zones.map((z) => {
    const mine = items.filter((i) => i.zone_id === z.zone_id);
    return { zone_id: z.zone_id, minutes: mine.every((i) => i.minutes != null) ? sum(mine.map((i) => i.minutes!)) : null };
  });
  const keys = new Set(
    project.zones.flatMap((z) => z.work_items.flatMap((i) => findOperation(lib, i)?.op.needs.map((n) => n.resource) ?? [])),
  );
  return {
    items,
    zones,
    minutes: zones.every((z) => z.minutes != null) ? sum(zones.map((z) => z.minutes!)) : null,
    resources: lib.resources.filter((r) => keys.has(r.key)),
    missing: items.flatMap((i) => i.missing.map((what) => ({ item_id: i.item_id, zone_id: i.zone_id, what }))),
  };
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------------------
// Scope of work wording
// ---------------------------------------------------------------------------

/**
 * The proposal line for a work item, from the operation's scope text. Only
 * the confirmed work: no time, crew or price.
 */
export function scopeLine(lib: Library, item: WorkItem): string | null {
  const found = findOperation(lib, item);
  if (!found?.op.scope_text) return null;
  const subtypeName = found.subtype?.name ?? found.material.name;
  return found.op.scope_text
    .replaceAll("{qty}", String(item.quantity))
    .replaceAll("{unit}", UNIT_WORDS[item.unit])
    .replaceAll("{subtype}", subtypeName.toLowerCase());
}

const UNIT_WORDS: Record<(typeof UNITS)[number], string> = {
  sqft: "square feet", lnft: "linear feet", sqyd: "square yards", cuyd: "cubic yards",
  each: "", ton: "tons", lb: "pounds", gal: "gallons", hr: "hours",
};

// ---------------------------------------------------------------------------
// Starting library
// ---------------------------------------------------------------------------

const SHEET = "Production rates sheet (provisional)";
const shrubRemoval = [
  { when: { size_class: "small" }, minutes_per_unit: 10, source: `${SHEET}: Small shrub removal` },
  { when: { size_class: "medium" }, minutes_per_unit: 20, source: `${SHEET}: Medium shrub removal` },
  { when: { size_class: "large" }, minutes_per_unit: 50, source: `${SHEET}: Large shrub removal` },
];

/**
 * The library the app starts from until the business saves its own. Rates
 * are from the production rates sheet, all still provisional. Values the
 * company hasn't set yet (mulch depth, river rock depth and weight, costs)
 * are left out on purpose, so a calculation that needs them says so.
 */
export const DEFAULT_LIBRARY: LibraryInput = {
  version: 1,
  resources: [
    { key: "round_point_shovel", kind: "tool", name: "Round point shovel" },
    { key: "pruning_saw", kind: "tool", name: "Pruning saw" },
    { key: "wheelbarrow", kind: "tool", name: "Wheelbarrow" },
    { key: "bow_rake", kind: "tool", name: "Bow rake" },
    { key: "pitchfork", kind: "tool", name: "Mulch fork" },
    { key: "dump_trailer", kind: "vehicle", name: "Dump trailer" },
    { key: "green_waste_disposal", kind: "disposal", name: "Green waste disposal" },
  ],
  materials: [
    {
      key: "plant",
      name: "Plant",
      subtypes: [
        { key: "japanese_barberry", name: "Japanese barberry", properties: { chemical_biological: { root_system: "fibrous", thorns: true } } },
        { key: "arborvitae", name: "Arborvitae", properties: { chemical_biological: { root_system: "shallow_fibrous" } } },
        { key: "boxwood", name: "Boxwood", properties: { chemical_biological: { root_system: "shallow_fibrous" } } },
      ],
      operations: [
        {
          operation: "remove",
          subtype: null,
          unit: "each",
          rate_unit: "each",
          measure: [{ key: "size_class", label: "Size", options: ["small", "medium", "large"], evidence: "photo of each plant" }],
          scope_text: "Remove {qty} existing {subtype}, including root removal and debris disposal.",
          rates: shrubRemoval,
          needs: [
            { resource: "round_point_shovel" },
            { resource: "pruning_saw" },
            { resource: "wheelbarrow" },
            { resource: "dump_trailer" },
            { resource: "green_waste_disposal", per: "unit" },
          ],
        },
      ],
    },
    {
      key: "mulch",
      name: "Mulch",
      subtypes: [{ key: "brown_hardwood", name: "Brown hardwood mulch" }],
      operations: [
        {
          operation: "install",
          subtype: null,
          unit: "sqft",
          rate_unit: "cuyd",
          scope_text: "Prepare the bed and install {subtype} across approximately {qty} {unit} at our standard depth.",
          rates: [{ minutes_per_unit: 59.88, source: `${SHEET}: Mulch installation` }],
          needs: [{ resource: "pitchfork" }, { resource: "wheelbarrow" }, { resource: "bow_rake" }],
        },
      ],
    },
    {
      key: "stone",
      name: "Stone",
      subtypes: [{ key: "river_rock", name: "River rock" }],
      operations: [
        {
          operation: "install",
          subtype: null,
          unit: "sqft",
          rate_unit: "ton",
          scope_text: "Prepare the area and install {subtype} across approximately {qty} {unit}.",
          rates: [{ minutes_per_unit: 120.48, source: `${SHEET}: Decorative rock installation` }],
          needs: [{ resource: "round_point_shovel" }, { resource: "wheelbarrow" }, { resource: "bow_rake" }],
        },
      ],
    },
  ],
};

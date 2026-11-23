/**
 * Stage 2 of the job pipeline: the resource library, and resources.msgpack,
 * the snapshot it is handed on in.
 *
 * Stage 1 (evaluation-line-items.ts) says what one project needs. This is
 * what the company knows, reused by every project:
 *
 *   Material -> Subtype -> properties
 *            -> Operation -> required inputs, production model (rates and
 *                            standards), tools and equipment, scope template
 *   Shared resources (tools, equipment, disposal), each defined once.
 *
 * Stage 2 stores and retrieves. It does not calculate project results:
 * that is Stage 3 (stage3-calculations.ts).
 *
 * Every material, subtype, resource and production model has a permanent id
 * so projects can reference them instead of copying them. Each library
 * snapshot has a version, and calculations record the version they used.
 *
 * Tables: supabase/migrations/0392_resource_library.sql. Starting data:
 * the Maryland catalog in resource-catalog-md.ts.
 */

import { decode, encode } from "@msgpack/msgpack";
import { z } from "zod";

import { OPERATIONS, UNITS, toKey, type WorkItem } from "@/lib/evaluation-line-items";
import {
  MD_DEBRIS,
  MD_DRAINAGE,
  MD_EDGING,
  MD_HARDSCAPE,
  MD_MULCH,
  MD_PLANTS,
  MD_SOIL,
  MD_STONE,
  MD_TURF,
} from "@/lib/resource-catalog-md";

export const STAGE_2 = 2;
export const STAGE_2_SCHEMA_VERSION = 1;

/** Operation ids, as in the architecture doc: install 1, remove 2, maintain 3. */
export const OPERATION_IDS = { install: 1, remove: 2, maintain: 3 } as const;

const keyStr = z.string().transform(toKey).pipe(z.string().min(1));
const props = z.record(z.string(), z.unknown()).default({});
const unit = z.enum(UNITS);
const id = z.number().int().positive();

const rateSchema = z.object({
  /** Measurements this rate is for, e.g. { size_class: "large" }. {} is the fallback. */
  when: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  minutes_per_unit: z.number().finite().nonnegative(),
  source: z.string().optional(),
  status: z.enum(["provisional", "verified"]).default("provisional"),
});

const needSchema = z.object({
  /** Id of a shared resource. */
  resource_id: id,
  amount: z.number().nonnegative().default(1),
  per: z.enum(["job", "unit", "labor_hour"]).default("job"),
});

/** Something the evaluator must measure, observe or photograph. */
const inputSchema = z.object({
  key: keyStr,
  label: z.string().optional(),
  options: z.array(z.string()).optional(),
  unit: z.string().optional(),
  /** What to photograph or collect for it. */
  evidence: z.string().optional(),
  /** The tool to measure it with, if any. */
  tool_id: id.optional(),
});

const operationSchema = z.object({
  operation: z.enum(OPERATIONS),
  /** Production model id, e.g. "plant_remove". Calculations record it. */
  model_id: keyStr,
  /** Null: every subtype of the material without its own entry (limited by applies_to). */
  subtype: keyStr.nullable().default(null),
  /** For a material-wide operation: only subtypes whose kind is listed. Empty: all. */
  applies_to: z.array(z.string()).default([]),
  /** Unit the evaluator's quantity comes in. */
  unit,
  /** Unit the rate is per. Same as unit unless the work is rated differently. */
  rate_unit: unit,
  /** Company standards never asked of the evaluator, e.g. { depth_in: 2 }. */
  standards: z.record(z.string(), z.number()).default({}),
  required_inputs: z.array(inputSchema).default([]),
  /**
   * Customer wording for exactly this work. "{qty}", "{unit}" and "{subtype}"
   * are filled in. Never adds work beyond the operation itself.
   */
  scope_template: z.string().optional(),
  rates: z.array(rateSchema).default([]),
  needs: z.array(needSchema).default([]),
  properties: props,
});

const subtypeSchema = z.object({ id, key: keyStr, name: z.string(), properties: props });

const materialSchema = z.object({
  id,
  key: keyStr,
  name: z.string(),
  properties: props,
  subtypes: z.array(subtypeSchema).default([]),
  operations: z.array(operationSchema).default([]),
});

const resourceSchema = z.object({
  id,
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
    const dup = (what: string, values: (string | number)[]) => {
      const seen = new Set<string | number>();
      for (const v of values) {
        if (seen.has(v)) ctx.addIssue({ code: "custom", message: `${what} ${v} is defined twice` });
        seen.add(v);
      }
    };
    dup("Resource id", lib.resources.map((r) => r.id));
    dup("Resource", lib.resources.map((r) => r.key));
    dup("Material id", lib.materials.map((m) => m.id));
    dup("Material", lib.materials.map((m) => m.key));
    dup("Subtype id", lib.materials.flatMap((m) => m.subtypes.map((s) => s.id)));
    dup("Production model", lib.materials.flatMap((m) => m.operations.map((o) => o.model_id)));
    const resources = new Set(lib.resources.map((r) => r.id));
    for (const m of lib.materials) {
      dup(`${m.key} subtype`, m.subtypes.map((s) => s.key));
      dup(`${m.key} operation`, m.operations.map((o) => `${o.operation}/${o.subtype ?? "*"}/${o.applies_to.join("+")}`));
      const subtypes = new Set(m.subtypes.map((s) => s.key));
      for (const op of m.operations) {
        if (op.subtype && !subtypes.has(op.subtype)) ctx.addIssue({ code: "custom", message: `${m.key}: no subtype ${op.subtype}` });
        for (const n of op.needs) {
          if (!resources.has(n.resource_id)) {
            ctx.addIssue({ code: "custom", message: `${op.model_id} needs unknown resource ${n.resource_id}` });
          }
        }
      }
    }
  });

export type Library = z.output<typeof librarySchema>;
export type LibraryInput = z.input<typeof librarySchema>;
export type LibMaterial = z.output<typeof materialSchema>;
export type LibSubtype = z.output<typeof subtypeSchema>;
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
// Retrieval
// ---------------------------------------------------------------------------

/** Indexes built once per library snapshot, so each lookup is direct. */
export interface LibraryIndex {
  lib: Library;
  materials: Map<string, LibMaterial>;
  subtypes: Map<string, LibSubtype>; // "material/subtype"
  resources: Map<number, LibResource>;
}

const indexes = new WeakMap<Library, LibraryIndex>();

export function indexLibrary(lib: Library): LibraryIndex {
  const cached = indexes.get(lib);
  if (cached) return cached;
  const index: LibraryIndex = {
    lib,
    materials: new Map(lib.materials.map((m) => [m.key, m])),
    subtypes: new Map(lib.materials.flatMap((m) => m.subtypes.map((s) => [`${m.key}/${s.key}`, s] as const))),
    resources: new Map(lib.resources.map((r) => [r.id, r])),
  };
  indexes.set(lib, index);
  return index;
}

export interface Resolved {
  material: LibMaterial;
  /** Null when the item names no subtype, or one the library doesn't list. */
  subtype: LibSubtype | null;
  op: LibOperation;
  /** Material properties with the subtype's laid over them. */
  properties: Record<string, unknown>;
}

/**
 * The library entry for a work item: the subtype's own operation if it has
 * one, otherwise the material's (when it applies to this kind of subtype).
 * Null when the library doesn't cover it.
 */
export function findOperation(lib: Library, item: Pick<WorkItem, "operation" | "material" | "subtype">): Resolved | null {
  const ix = indexLibrary(lib);
  const material = ix.materials.get(item.material);
  if (!material) return null;
  const subtype = item.subtype ? (ix.subtypes.get(`${material.key}/${item.subtype}`) ?? null) : null;
  return operationFor(material, subtype, item.operation);
}

export function operationFor(material: LibMaterial, subtype: LibSubtype | null, operation: WorkItem["operation"]): Resolved | null {
  const kind = typeof subtype?.properties.kind === "string" ? subtype.properties.kind : null;
  const op =
    (subtype && material.operations.find((o) => o.operation === operation && o.subtype === subtype.key)) ||
    material.operations.find(
      (o) => o.operation === operation && o.subtype === null && (o.applies_to.length === 0 || (kind != null && o.applies_to.includes(kind))),
    );
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

export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The stored rate that fits a work item's measurements, the most specific
 * first. When the rates depend on a measurement the item doesn't have, it is
 * named in `needs` so the evaluator can be asked for it.
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

/** What the evaluator must collect for a work item, for the form's on-site check. */
export function requiredInputs(lib: Library, item: Pick<WorkItem, "operation" | "material" | "subtype">) {
  return findOperation(lib, item)?.op.required_inputs ?? [];
}

// ---------------------------------------------------------------------------
// Starting library: the Maryland catalog, with the rates from the
// production rates sheet (all provisional)
// ---------------------------------------------------------------------------

const SHEET = "Production rates sheet (provisional)";

export const RESOURCE_IDS = {
  round_point_shovel: 501,
  pruning_saw: 502,
  wheelbarrow: 503,
  bow_rake: 504,
  mulch_fork: 505,
  dump_trailer: 506,
  green_waste_disposal: 507,
  hand_pruners: 508,
  loppers: 509,
  hedge_trimmer: 510,
  tape_measure: 511,
  measuring_wheel: 512,
  soil_probe: 513,
  ph_meter: 514,
} as const;

const R = RESOURCE_IDS;

const SHRUB_KINDS = ["shrub", "evergreen_shrub"];

const materialRows = (materialId: number, rows: [string, string][]) =>
  rows.map(([key, name], i) => ({ id: materialId * 1000 + i + 1, key, name }));

export const DEFAULT_LIBRARY: LibraryInput = {
  version: 1,
  resources: [
    { id: R.round_point_shovel, key: "round_point_shovel", kind: "tool", name: "Round point shovel" },
    { id: R.pruning_saw, key: "pruning_saw", kind: "tool", name: "Pruning saw" },
    { id: R.wheelbarrow, key: "wheelbarrow", kind: "tool", name: "Wheelbarrow" },
    { id: R.bow_rake, key: "bow_rake", kind: "tool", name: "Bow rake" },
    { id: R.mulch_fork, key: "mulch_fork", kind: "tool", name: "Mulch fork" },
    { id: R.dump_trailer, key: "dump_trailer", kind: "vehicle", name: "Dump trailer" },
    { id: R.green_waste_disposal, key: "green_waste_disposal", kind: "disposal", name: "Green waste disposal" },
    { id: R.hand_pruners, key: "hand_pruners", kind: "tool", name: "Hand pruners" },
    { id: R.loppers, key: "loppers", kind: "tool", name: "Loppers" },
    { id: R.hedge_trimmer, key: "hedge_trimmer", kind: "equipment", name: "Hedge trimmer" },
    { id: R.tape_measure, key: "tape_measure", kind: "tool", name: "Tape measure" },
    { id: R.measuring_wheel, key: "measuring_wheel", kind: "tool", name: "Measuring wheel" },
    { id: R.soil_probe, key: "soil_probe", kind: "tool", name: "Soil probe" },
    { id: R.ph_meter, key: "ph_meter", kind: "tool", name: "Soil pH meter" },
  ],
  materials: [
    {
      id: 1,
      key: "plant",
      name: "Plant",
      subtypes: MD_PLANTS.map(([key, name, botanical, kind, origin], i) => ({
        id: 1000 + i + 1,
        key,
        name,
        properties: { kind, botanical_name: botanical, origin },
      })),
      operations: [
        {
          operation: "remove",
          model_id: "shrub_remove",
          applies_to: SHRUB_KINDS,
          unit: "each",
          rate_unit: "each",
          required_inputs: [
            { key: "size_class", label: "Size", options: ["small", "medium", "large"], evidence: "photo of each plant" },
            { key: "height_ft", label: "Height", unit: "ft", tool_id: R.tape_measure },
          ],
          scope_template: "Remove {qty} existing {subtype}.",
          rates: [
            { when: { size_class: "small" }, minutes_per_unit: 10, source: `${SHEET}: Small shrub removal` },
            { when: { size_class: "medium" }, minutes_per_unit: 20, source: `${SHEET}: Medium shrub removal` },
            { when: { size_class: "large" }, minutes_per_unit: 50, source: `${SHEET}: Large shrub removal` },
          ],
          needs: [
            { resource_id: R.round_point_shovel },
            { resource_id: R.pruning_saw },
            { resource_id: R.wheelbarrow },
            { resource_id: R.dump_trailer },
          ],
        },
        {
          operation: "install",
          model_id: "shrub_install",
          applies_to: SHRUB_KINDS,
          unit: "each",
          rate_unit: "each",
          required_inputs: [
            { key: "container_size", label: "Container", options: ["1_gal", "3_gal", "5_gal", "7_gal", "15_gal", "b_and_b"] },
            { key: "soil_ph", label: "Soil pH", tool_id: R.ph_meter },
          ],
          scope_template: "Install {qty} {subtype}.",
          rates: [
            { when: { container_size: "3_gal" }, minutes_per_unit: 12.05, source: `${SHEET}: Three-gallon shrub installation` },
            { when: { container_size: "5_gal" }, minutes_per_unit: 20, source: `${SHEET}: Five-gallon shrub installation` },
          ],
          needs: [{ resource_id: R.round_point_shovel }, { resource_id: R.wheelbarrow }],
        },
        {
          operation: "maintain",
          model_id: "shrub_maintain",
          applies_to: SHRUB_KINDS,
          unit: "each",
          rate_unit: "each",
          required_inputs: [{ key: "size_class", label: "Size", options: ["small", "medium", "large"], evidence: "photo of each plant" }],
          scope_template: "Maintain {qty} {subtype}.",
          rates: [
            { when: { size_class: "small" }, minutes_per_unit: 10, source: `${SHEET}: Small shrub trimming` },
            { when: { size_class: "medium" }, minutes_per_unit: 20, source: `${SHEET}: Medium shrub trimming` },
            { when: { size_class: "large" }, minutes_per_unit: 40, source: `${SHEET}: Large shrub trimming` },
          ],
          needs: [{ resource_id: R.hand_pruners }, { resource_id: R.loppers }, { resource_id: R.hedge_trimmer }],
        },
      ],
    },
    {
      id: 2,
      key: "mulch",
      name: "Mulch",
      subtypes: materialRows(2, MD_MULCH),
      operations: [
        {
          operation: "install",
          model_id: "mulch_install",
          unit: "sqft",
          rate_unit: "cuyd",
          standards: { depth_in: 2 },
          required_inputs: [{ key: "area", label: "Bed length and width", unit: "ft", tool_id: R.measuring_wheel, evidence: "photo of the bed" }],
          scope_template: "Install {subtype} across approximately {qty} {unit} at our standard depth.",
          rates: [{ minutes_per_unit: 59.88, source: `${SHEET}: Mulch installation` }],
          needs: [{ resource_id: R.mulch_fork }, { resource_id: R.wheelbarrow }, { resource_id: R.bow_rake }],
        },
      ],
    },
    {
      id: 3,
      key: "stone",
      name: "Stone",
      subtypes: materialRows(3, MD_STONE),
      operations: [
        {
          operation: "install",
          model_id: "stone_install",
          unit: "sqft",
          rate_unit: "ton",
          required_inputs: [{ key: "area", label: "Area length and width", unit: "ft", tool_id: R.measuring_wheel, evidence: "photo of the area" }],
          scope_template: "Install {subtype} across approximately {qty} {unit}.",
          rates: [{ minutes_per_unit: 120.48, source: `${SHEET}: Decorative rock installation` }],
          needs: [{ resource_id: R.round_point_shovel }, { resource_id: R.wheelbarrow }, { resource_id: R.bow_rake }],
        },
      ],
    },
    { id: 4, key: "soil", name: "Soil and amendments", subtypes: materialRows(4, MD_SOIL) },
    { id: 5, key: "turf", name: "Turf and seed", subtypes: materialRows(5, MD_TURF) },
    { id: 6, key: "hardscape", name: "Hardscape", subtypes: materialRows(6, MD_HARDSCAPE) },
    { id: 7, key: "edging", name: "Edging", subtypes: materialRows(7, MD_EDGING) },
    { id: 8, key: "drainage", name: "Drainage", subtypes: materialRows(8, MD_DRAINAGE) },
    { id: 9, key: "debris", name: "Debris and cleanup", subtypes: materialRows(9, MD_DEBRIS) },
  ],
};

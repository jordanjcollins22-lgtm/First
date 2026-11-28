/**
 * Stage 1 of the job pipeline: what the evaluation form produces, and the
 * MessagePack file it is handed to stage 2 in.
 *
 * A project (job) has zones; each zone has its own location, field readings
 * and evidence, and a list of work items:
 *
 *   { project_id: 1001, zones: [
 *     { zone_id: 1, name: "front_mulch_bed", location: null,
 *       site_conditions: {}, evidence: [],
 *       work_items: [
 *         { operation: "remove", material: "plant", subtype: "japanese_barberry", quantity: 2, unit: "each" },
 *         { operation: "install", material: "mulch", subtype: "brown_hardwood", quantity: 200, unit: "sqft" } ] } ] }
 *
 * The file is that object plus { stage: 1, schema_version }, packed as
 * MessagePack. Pure, so the rules are tested without a database. Tables:
 * supabase/migrations/0391_evaluation_line_items.sql.
 */

import { decode, encode } from "@msgpack/msgpack";
import { z } from "zod";

export const STAGE_1 = 1;
export const STAGE_1_SCHEMA_VERSION = 1;

export const OPERATIONS = ["install", "remove", "maintain"] as const;
export const UNITS = ["sqft", "lnft", "sqyd", "cuyd", "each", "ton", "lb", "gal", "hr"] as const;

/** "Brown hardwood" -> "brown_hardwood", the way the file stores names. */
export function toKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Units as people say them, mapped to the file's short form. */
const UNIT_ALIASES: Record<string, (typeof UNITS)[number]> = {
  square_feet: "sqft", square_foot: "sqft", sq_ft: "sqft", sf: "sqft",
  linear_feet: "lnft", linear_foot: "lnft", lin_ft: "lnft", lf: "lnft",
  square_yards: "sqyd", square_yard: "sqyd", sq_yd: "sqyd",
  cubic_yards: "cuyd", cubic_yard: "cuyd", cu_yd: "cuyd", yards: "cuyd", yd: "cuyd",
  ea: "each", count: "each", pieces: "each",
  tons: "ton", pounds: "lb", lbs: "lb", gallons: "gal",
  hours: "hr", hrs: "hr",
};

const key = z.string().transform(toKey).pipe(z.string().min(1));
const optionalKey = z
  .string()
  .nullish()
  .transform((v) => (v == null || toKey(v) === "" ? null : toKey(v)));

const evidenceRef = z.object({
  kind: z.enum(["photo", "sample", "video", "document"]),
  /** Storage path or id of the photo or sample. */
  ref: z.string().min(1),
  label: z.string().optional(),
});

/**
 * One measurement of a work item that changes how it is done (a shrub's
 * size, a tree's trunk width). Marked as measured on site, estimated by eye,
 * or inferred (from a photo or a rule), so later stages know how far to
 * trust it and can ask for a real measurement.
 */
export const measurementSchema = z.object({
  value: z.union([z.number(), z.string(), z.boolean()]),
  unit: z.string().optional(),
  source: z.enum(["measured", "estimated", "inferred"]),
});

export const workItemSchema = z.object({
  /** Stable number within the project, so later stages can point back to it. */
  item_id: z.number().int().positive().optional(),
  operation: z.string().transform(toKey).pipe(z.enum(OPERATIONS)),
  material: key,
  subtype: optionalKey,
  quantity: z.coerce.number().finite().nonnegative(),
  unit: z
    .string()
    .transform((v) => UNIT_ALIASES[toKey(v)] ?? toKey(v))
    .pipe(z.enum(UNITS)),
  /** e.g. { size_class: { value: "large", source: "measured" } }. */
  measurements: z.record(z.string().transform(toKey), measurementSchema).optional(),
});

export const zoneSchema = z.object({
  zone_id: z.number().int().positive(),
  name: key,
  location: optionalKey,
  /** Field measurements and test results, e.g. { soil_ph: 6.4 }. */
  site_conditions: z.record(z.string(), z.unknown()).default({}),
  /** References to photos and samples. */
  evidence: z.array(evidenceRef).default([]),
  work_items: z.array(workItemSchema).default([]),
});

export const projectSchema = z
  .object({
    /** The job. A number like 1001, or the job's id in the app. */
    project_id: z.union([z.number().int(), z.string().min(1)]),
    zones: z.array(zoneSchema),
  })
  .superRefine((p, ctx) => {
    const zones = new Set<number>();
    const items = new Set<number>();
    for (const zone of p.zones) {
      if (zones.has(zone.zone_id)) {
        ctx.addIssue({ code: "custom", message: `Zone ${zone.zone_id} is listed twice`, path: ["zones"] });
      }
      zones.add(zone.zone_id);
      for (const item of zone.work_items) {
        if (item.item_id == null) continue;
        if (items.has(item.item_id)) {
          ctx.addIssue({ code: "custom", message: `Work item ${item.item_id} is listed twice`, path: ["zones"] });
        }
        items.add(item.item_id);
      }
    }
  });

export type Measurement = z.output<typeof measurementSchema>;
export type WorkItem = z.output<typeof workItemSchema>;
export type Zone = z.output<typeof zoneSchema>;
export type Project = z.output<typeof projectSchema>;
export type ProjectInput = z.input<typeof projectSchema>;
export type EvidenceRef = z.output<typeof evidenceRef>;

export interface Stage1File extends Project {
  stage: typeof STAGE_1;
  schema_version: number;
}

/** Check and tidy the evaluation. Throws with the field that is wrong. */
export function parseProject(input: unknown): Project {
  return projectSchema.parse(input);
}

/**
 * Give every work item without a number the next free one, so each has a
 * stable id before the file is saved. Numbers already given are kept.
 */
export function numberWorkItems(project: Project): Project {
  let next = 1 + Math.max(0, ...project.zones.flatMap((z) => z.work_items.map((i) => i.item_id ?? 0)));
  return {
    ...project,
    zones: project.zones.map((z) => ({
      ...z,
      work_items: z.work_items.map((i) => (i.item_id != null ? i : { ...i, item_id: next++ })),
    })),
  };
}

/** Work items across every zone, for item_count and totals. */
export function countWorkItems(project: Project): number {
  return project.zones.reduce((n, z) => n + z.work_items.length, 0);
}

/** Pack a job's evaluation into the stage 1 MessagePack file. */
export function packStage1(input: ProjectInput): Uint8Array {
  const file: Stage1File = { stage: STAGE_1, schema_version: STAGE_1_SCHEMA_VERSION, ...numberWorkItems(parseProject(input)) };
  return encode(file);
}

/** Read a stage 1 file back. Throws if it is not a stage 1 file this code can read. */
export function unpackStage1(bytes: Uint8Array): Stage1File {
  const raw = decode(bytes) as Partial<Stage1File> | null;
  if (!raw || typeof raw !== "object" || raw.stage !== STAGE_1) {
    throw new Error("Not a stage 1 evaluation file");
  }
  if (raw.schema_version !== STAGE_1_SCHEMA_VERSION) {
    throw new Error(`Unknown evaluation file version ${String(raw.schema_version)}`);
  }
  return { stage: STAGE_1, schema_version: raw.schema_version, ...parseProject(raw) };
}

/** Hex sha256 of the file, stored next to it so stage 2 can confirm it is intact. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * bytea goes through PostgREST as "\x" + hex. These turn the file into that
 * and back, for inserts into and reads from job_stage_files.content.
 */
export function toByteaHex(bytes: Uint8Array): string {
  return "\\x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromByteaHex(value: string): Uint8Array {
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error("Not a bytea hex string");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

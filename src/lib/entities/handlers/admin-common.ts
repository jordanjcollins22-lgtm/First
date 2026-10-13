/**
 * Small shared pieces for the Admin handlers: reading rows loosely, turning
 * the many result shapes the existing actions return into one, and laying
 * out fields. Not pure (it touches the database through the caller's
 * client), so the rules worth testing live in ./admin-format.ts.
 */
import type { ActionResult, EntityField } from "@/lib/entities/types";

export type Row = Record<string, unknown>;
// The handlers read dozens of tables by name; generated types would need a
// branch per table for no gain here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Q = any;

export const str = (x: unknown): string => (typeof x === "string" ? x : x == null ? "" : String(x));
export const num = (x: unknown): number => (typeof x === "number" ? x : Number(x ?? 0) || 0);

/** One row, or null when it is not there or cannot be read. */
export async function one(q: Q): Promise<Row | null> {
  try {
    const { data, error } = await q.maybeSingle();
    return error ? null : ((data as Row | null) ?? null);
  } catch {
    return null;
  }
}

/** Rows, or none when they cannot be read. */
export async function many(q: Q): Promise<Row[]> {
  try {
    const { data, error } = await q;
    return error ? [] : ((data ?? []) as Row[]);
  } catch {
    return [];
  }
}

/** Fields with something in them; blanks are left off rather than shown as dashes. */
export function fields(list: [string, unknown][]): EntityField[] {
  return list
    .map(([label, value]) => ({ label, value: str(value).trim() }))
    .filter((f) => f.value && f.value !== "—");
}

type AnyResult =
  | { ok: boolean; message?: string; error?: string }
  | null
  | undefined
  | void;

/** Whatever an existing action returned, as the drawer's result. */
export function result(r: AnyResult, fallback = "Done."): ActionResult {
  if (!r) return { ok: true, message: fallback };
  if (r.ok) return { ok: true, message: r.message || fallback };
  return { ok: false, error: r.error || r.message || "That didn't work." };
}

/** Runs an action that throws on failure rather than returning a result. */
export async function attempt(work: () => Promise<unknown>, message: string): Promise<ActionResult> {
  try {
    await work();
    return { ok: true, message };
  } catch (err) {
    const why = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "";
    return { ok: false, error: why || "That didn't work. Try again." };
  }
}

export const UNKNOWN: ActionResult = { ok: false, error: "That isn't something this can do." };

/** A person's name from a profiles row. */
export function personName(p: Row | null | undefined): string {
  if (!p) return "Unknown";
  return str(p.full_name) || [str(p.first_name), str(p.last_name)].filter(Boolean).join(" ") || str(p.email) || "Unknown";
}

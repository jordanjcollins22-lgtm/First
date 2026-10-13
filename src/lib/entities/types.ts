/**
 * Anything listed in the new layout can be opened and acted on: a campaign,
 * a mailing, a client, a proposal, a work day, a purchase order. A list row
 * carries an EntityRef; clicking it opens a drawer that asks the handler for
 * that kind what to show and what can be done, and runs the action chosen.
 *
 * Handlers live in ./handlers/<department>.ts and are collected in
 * ./registry.ts. Every handler only reads and writes the caller's own
 * business: ctx.organizationId is the signed-in owner's.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface EntityRef {
  kind: string;
  id: string;
}

/** A list row: plain words, or words that open something. */
export interface EntityRow {
  text: string;
  ref?: EntityRef;
}

export type ListRow = string | EntityRow;

export interface EntityField {
  label: string;
  value: string;
}

export interface EntityActionInput {
  type: "text" | "textarea" | "number" | "date" | "select" | "email" | "tel";
  label: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
  /** Pre-filled value, e.g. the current status. */
  initial?: string;
  required?: boolean;
}

export interface EntityAction {
  id: string;
  label: string;
  tone?: "primary" | "danger" | "default";
  /** Asked before running, e.g. "Pause this campaign?" */
  confirm?: string;
  /** One value to collect first, e.g. a new status or a note. */
  input?: EntityActionInput;
}

export interface EntityView {
  title: string;
  subtitle?: string;
  status?: string;
  fields: EntityField[];
  /** Related things, each openable in turn: a campaign's recipients, a job's work days. */
  sections?: { title: string; rows: EntityRow[]; empty?: string }[];
  actions: EntityAction[];
  /** Words under the actions: what the actions do, or why there are none. */
  note?: string;
}

export interface EntityContext {
  /** The signed-in owner's client: row security applies. */
  sb: SupabaseClient;
  /** The service-role client, for writes the owner may make that RLS blocks. Use sparingly. */
  admin: SupabaseClient;
  organizationId: string;
  profileId: string;
}

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export interface EntityHandler {
  kind: string;
  load(ctx: EntityContext, id: string): Promise<EntityView | null>;
  act?(ctx: EntityContext, id: string, action: string, value?: string): Promise<ActionResult>;
}

/** Shorthand for a row that opens something. */
export function row(text: string, kind: string, id: unknown): EntityRow {
  return typeof id === "string" && id ? { text, ref: { kind, id } } : { text };
}

/** The words of a row, whichever form it is in. */
export function rowText(r: ListRow): string {
  return typeof r === "string" ? r : r.text;
}

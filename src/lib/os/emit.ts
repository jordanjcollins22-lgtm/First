/**
 * Recording a fact from inside the app's existing actions.
 *
 * Shadow mode, deliberately: an emit never throws and never changes what the
 * action around it does. If the backbone is switched off, the business has
 * not turned events on, the payload is malformed, or the database is down,
 * the action carries on exactly as it did before this file existed, and the
 * reason is logged.
 *
 * Two switches, both off by default: OS_EVENT_BACKBONE=on for the deployment,
 * and automation_controls.events_enabled for the business.
 */

import { CONSUMERS, validateEvent, type EventInput, type EventType } from "@/lib/os/contracts";
import { SupabaseStore } from "@/lib/os/supabase-store";
import { log } from "@/lib/log";

export function backboneEnabled(): boolean {
  return process.env.OS_EVENT_BACKBONE === "on";
}

export type EmitResult =
  | { recorded: true; eventId: string; inserted: boolean }
  | { recorded: false; reason: "off" | "org_off" | "invalid" | "error"; detail?: string };

export async function emitEvent<T extends EventType>(input: EventInput<T>): Promise<EmitResult> {
  if (!backboneEnabled()) return { recorded: false, reason: "off" };
  try {
    const valid = validateEvent(input as EventInput);
    if (!valid.ok) {
      log.warn("os.event_invalid", { type: input.type, problems: valid.problems });
      return { recorded: false, reason: "invalid", detail: valid.problems.join("; ") };
    }
    const store = new SupabaseStore();
    const controls = await store.controls(input.organizationId);
    if (!controls.eventsEnabled) return { recorded: false, reason: "org_off" };
    const { eventId, inserted } = await store.recordEvent(input as EventInput, CONSUMERS[input.type]);
    return { recorded: true, eventId, inserted };
  } catch (err) {
    log.warn("os.event_not_recorded", { type: input.type, error: err instanceof Error ? err.message : String(err) });
    return { recorded: false, reason: "error" };
  }
}

/** Dollars as the app stores them, to integer cents for an event. */
export function toCents(dollars: number | string | null | undefined): number {
  const n = typeof dollars === "string" ? Number(dollars) : (dollars ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0;
}

/** A timestamp or date column, as the ISO instant events carry. */
export function toInstant(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

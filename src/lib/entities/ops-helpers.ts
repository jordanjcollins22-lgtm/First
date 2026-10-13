/**
 * Pure pieces behind the Operations drawer handlers: what a status can move
 * to, which buttons an order shows, how a typed answer is read. Kept apart
 * from the handlers so they can be tested without a database.
 */
import type { ActionResult } from "@/lib/entities/types";

const TZ = "America/New_York";

/* ------------------------------------------------------------- formatting */

/** "2026-10-14" → "Wed, Oct 14". A bare date is a calendar day, not an instant. */
export function dayLabel(ymd: unknown): string {
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return "—";
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

/** A timestamp as "Oct 14, 3:05 PM" in the business's time zone. */
export function stampLabel(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** A span of days: one day alone, or "Mon, Oct 13 to Wed, Oct 15". */
export function spanLabel(start: unknown, end: unknown): string {
  if (!start) return "—";
  return !end || end === start ? dayLabel(start) : `${dayLabel(start)} to ${dayLabel(end)}`;
}

export function cents(n: unknown): string {
  const v = Number(n);
  if (n == null || !Number.isFinite(v)) return "—";
  return "$" + (v / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function dollars(n: unknown): string {
  const v = Number(n);
  if (n == null || n === "" || !Number.isFinite(v)) return "—";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** "in_progress" → "In progress". */
export function words(s: unknown): string {
  if (typeof s !== "string" || !s) return "—";
  const t = s.replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "12 Haystack Court, Forest Hill, Maryland 21050" → "12 Haystack Court, Forest Hill" */
export function shortPlace(name: unknown): string {
  const parts = String(name ?? "")
    .split(/\s+[—-]\s+|,/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length >= 2 && /\d/.test(parts[0]) ? `${parts[0]}, ${parts[1]}` : (parts[0] ?? "—");
}

/* ---------------------------------------------------------------- reading */

/** A typed number, or null for blank. NaN when it isn't a number at all. */
export function parseNumber(value: string | undefined): number | null {
  const t = (value ?? "").trim().replace(/[$,]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export function isDay(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
}

/**
 * An issue closes with two answers: what was done, and what changes so it
 * can't happen again. The drawer asks for one box, so they go on two lines
 * (or either side of a "/"). Null when the second is missing.
 */
export function splitResolution(text: string | undefined): { resolution: string; prevention: string } | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const lines = t.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean);
  if (lines.length >= 2) return { resolution: lines[0], prevention: lines.slice(1).join(" ") };
  const slash = t.split(/\s+\/\s+/);
  if (slash.length >= 2 && slash[0].trim() && slash.slice(1).join(" / ").trim()) {
    return { resolution: slash[0].trim(), prevention: slash.slice(1).join(" / ").trim() };
  }
  return null;
}

/* ------------------------------------------------------------- job status */

export const JOB_STATUS_WORDS: Record<string, string> = {
  estimating: "Estimating",
  quoted: "Quoted",
  approved: "Approved",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

/**
 * Where a job can be moved by hand from the drawer. Finishing goes through
 * "Mark complete" (it has gates: the walkthrough, the client's approval, the
 * photos), cancelling and reopening through their own buttons, so neither is
 * offered here. A closed job can't be moved at all.
 */
export function jobStatusMoves(current: string): string[] {
  if (current === "completed" || current === "cancelled") return [];
  return ["estimating", "quoted", "approved", "in_progress"].filter((s) => s !== current);
}

/* -------------------------------------------------------------- work days */

export const WORK_DAY_WORDS: Record<string, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  paused: "Paused",
  done: "Done",
  cancelled: "Cancelled",
};

export function workDayIsOpen(status: string): boolean {
  return status !== "done" && status !== "cancelled";
}

/** Moving a visit keeps its length: a three-day job moved to Monday ends on Wednesday. */
export function shiftSpan(start: string, end: string, newStart: string): { start: string; end: string } {
  const a = Date.parse(`${start}T12:00:00Z`);
  const b = Date.parse(`${end || start}T12:00:00Z`);
  const days = Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 864e5) : 0;
  const s = Date.parse(`${newStart}T12:00:00Z`);
  return { start: newStart, end: new Date(s + days * 864e5).toISOString().slice(0, 10) };
}

/* -------------------------------------------------------- purchase orders */

export type PoAction = "approve" | "send" | "sent_by_hand" | "confirm" | "receive" | "cancel";

/** Which buttons an order shows, from where it stands. Mirrors the checks the actions make. */
export function poActions(po: { status: string; approvedAt: string | null; supplierId: string | null }): PoAction[] {
  const out: PoAction[] = [];
  if (po.status === "draft") {
    if (!po.approvedAt && po.supplierId) out.push("approve");
    if (po.approvedAt && po.supplierId) out.push("send");
    out.push("sent_by_hand");
  }
  if (po.status === "sent") out.push("confirm");
  if (["sent", "confirmed", "partial"].includes(po.status)) out.push("receive");
  if (!["delivered", "picked_up", "cancelled"].includes(po.status)) out.push("cancel");
  return out;
}

/** What is still to come on each line: ordered less what has arrived. */
export function outstandingLines(lines: { id: string; quantity: number; received: number }[]): { lineId: string; quantity: number }[] {
  return lines
    .map((l) => ({ lineId: l.id, quantity: Math.round((Number(l.quantity) - Number(l.received || 0)) * 100) / 100 }))
    .filter((l) => l.quantity > 0);
}

/* ------------------------------------------------------------- applicants */

/** An applicant's next steps, split: rejecting is its own button, the rest is "advance". */
export function applicantMoves(next: string[]): { advance: string[]; reject: boolean } {
  return { advance: next.filter((s) => s !== "not_a_fit" && s !== "withdrawn"), reject: next.includes("not_a_fit") };
}

/* --------------------------------------------------------------- sign-off */

/**
 * What a job really cost, typed into one box at sign-off: crew hours, then
 * materials in dollars, then anything else (0 when left off). "32, 410, 0".
 */
export function parseCosts(text: string | undefined): { crewHours: number; materialsDollars: number; otherDollars: number } | null {
  const parts = (text ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.replace(/\$/g, "").trim())
    .filter(Boolean)
    .map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return { crewHours: parts[0], materialsDollars: parts[1], otherDollars: parts[2] ?? 0 };
}

/* ---------------------------------------------------------------- results */

type Loose =
  | { ok: true; message?: string | null; value?: unknown }
  | { ok: false; message?: string | null; error?: string | null }
  | null
  | undefined
  | void;

/** The existing actions answer in three shapes; the drawer wants one. */
export function toResult(r: Loose, okMessage?: string): ActionResult {
  if (!r) return { ok: true, message: okMessage };
  if (r.ok) return { ok: true, message: (r.message ?? undefined) || okMessage };
  return { ok: false, error: r.error || r.message || "That didn't work. Try again." };
}

/** For the actions that throw instead of answering. */
export async function attempt(fn: () => Promise<unknown>, okMessage: string): Promise<ActionResult> {
  try {
    await fn();
    return { ok: true, message: okMessage };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.message ? err.message : "That didn't work. Try again." };
  }
}

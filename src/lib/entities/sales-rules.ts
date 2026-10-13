/**
 * The rules behind the Sales drawer's buttons: which status changes are
 * allowed and how each one is carried out, which proposal actions make sense
 * for a proposal's state, how a typed visit time is read, how far an expiry
 * moves. Pure, so the handler and its tests read the same answers.
 */

import { zonedTime } from "@/lib/automations";
import { classifyMissedVisit } from "@/lib/client-automations/no-show";
import { expiryOf } from "@/lib/proposal-validity";
import type { JobStatus } from "@/types/domain";

export const SALES_TZ = "America/New_York";

export const JOB_STATUS_CHOICES: { value: JobStatus; label: string }[] = [
  { value: "estimating", label: "Estimating" },
  { value: "quoted", label: "Quoted" },
  { value: "approved", label: "Approved" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const JOB_STATUSES = new Set<string>(JOB_STATUS_CHOICES.map((c) => c.value));

/**
 * How a status change is done. Cancelling goes through cancelJob (clears the
 * work dates, keeps the reason), leaving a cancelled job goes through
 * reopenJob first, everything else is a plain status write.
 */
export type StatusPlan =
  | { ok: true; via: "cancel" }
  | { ok: true; via: "reopen_then_set"; status: JobStatus }
  | { ok: true; via: "set"; status: JobStatus }
  | { ok: false; error: string };

export function planStatusChange(current: string, next: string): StatusPlan {
  if (!JOB_STATUSES.has(next)) return { ok: false, error: "Pick a status." };
  if (current === next) return { ok: false, error: "It's already at that status." };
  if (next === "cancelled") {
    if (current === "completed") return { ok: false, error: "This job is finished. Cancelling it now would erase completed work." };
    return { ok: true, via: "cancel" };
  }
  if (current === "cancelled") return { ok: true, via: "reopen_then_set", status: next as JobStatus };
  return { ok: true, via: "set", status: next as JobStatus };
}

/** The reason written for a no-show: read as a no-show by the rebook sequence. */
export const NO_SHOW_REASON = "No-show: nobody was home for the visit.";

/** A cancel reason that the rebook sequence must not treat as the client's doing unless it says so. */
export function cancelReason(text: string | undefined): string | null {
  const t = (text ?? "").trim();
  return t ? t.slice(0, 500) : null;
}

/** Whether marking a visit missed will start the no-show rebook messages. */
export function startsRebook(reason: string): boolean {
  return classifyMissedVisit(reason) != null;
}

/**
 * A typed visit time, "2026-10-20 10:30" or "2026-10-20 2:30 pm", read as
 * the business's local time. Null when it can't be read.
 */
export function parseVisitTime(text: string | undefined, timeZone = SALES_TZ): Date | null {
  const m = (text ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i);
  if (!m) return null;
  const [, y, mo, d, hText, minText, ampm] = m;
  let hour = hText ? Number(hText) : 9;
  const minute = minText ? Number(minText) : 0;
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (ampm.toLowerCase() === "pm" ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  const at = zonedTime(`${y}-${mo}-${d}`, hour, minute, timeZone);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** An instant as the text parseVisitTime reads back, in local time: "2026-10-20 14:30". */
export function visitTimeText(iso: string | null | undefined, timeZone = SALES_TZ): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** The new end of a moved visit: the same length as before, or none. */
export function movedEnd(oldStart: string | null, oldEnd: string | null, newStart: Date): string | null {
  if (!oldStart || !oldEnd) return null;
  const length = new Date(oldEnd).getTime() - new Date(oldStart).getTime();
  if (!(length > 0)) return null;
  return new Date(newStart.getTime() + length).toISOString();
}

export const EXTEND_DAY_OPTIONS = [7, 14, 30] as const;

/**
 * A proposal's new expiry: the days counted from whichever is later, now or
 * the old expiry, so extending never shortens it.
 */
export function extendedExpiry(current: string | null | undefined, now: Date, days: number): Date {
  const base = current && new Date(current).getTime() > now.getTime() ? new Date(current) : now;
  return expiryOf(base, days);
}

export type ProposalActionId = "approve" | "set_price" | "resend" | "extend" | "accept" | "decline" | "win_back" | "stop_messages";

/** Which proposal actions apply to a proposal in this state. */
export function proposalActionsFor(p: { status: string; approvedAt: string | null; expired: boolean; officeDeclinedFrom: string | null }): ProposalActionId[] {
  const out: ProposalActionId[] = [];
  if (p.status === "needs_approval") out.push("approve", "set_price", "decline");
  if (p.status === "sent") {
    if (p.approvedAt) out.push("resend");
    out.push("extend");
    if (!p.expired) out.push("accept");
    out.push("decline");
  }
  if (p.status === "declined") {
    // An expired proposal was closed by the clock: extending it reopens it.
    if (p.expired && p.officeDeclinedFrom === "sent") out.push("extend");
    out.push("win_back");
  }
  out.push("stop_messages");
  return out;
}

/**
 * The areas named in a typed list, matched to the proposal's own names
 * without minding case or spacing. Unknown names are returned separately
 * so the person is told which ones didn't match.
 */
export function readAreaList(text: string | undefined, names: string[]): { keep: string[]; unknown: string[] } {
  const byKey = new Map(names.map((n) => [n.trim().toLowerCase(), n]));
  const keep: string[] = [];
  const unknown: string[] = [];
  for (const raw of (text ?? "").split(/[\n,;]+/)) {
    const t = raw.trim();
    if (!t) continue;
    const hit = byKey.get(t.toLowerCase());
    if (hit) {
      if (!keep.includes(hit)) keep.push(hit);
    } else unknown.push(t);
  }
  return { keep, unknown };
}

/**
 * The areas to suggest for a Phase 1: every area but the dearest, so the
 * price comes in under what was declined. One area alone is suggested as is.
 */
export function suggestPhaseOne(areas: { name: string; cents: number | null }[]): string[] {
  if (areas.length <= 1) return areas.map((a) => a.name);
  let dearest = 0;
  areas.forEach((a, i) => {
    if ((a.cents ?? 0) > (areas[dearest].cents ?? 0)) dearest = i;
  });
  return areas.filter((_, i) => i !== dearest).map((a) => a.name);
}

/** "$1,250" from dollars; a dash for nothing. */
export function dollars(x: number | null | undefined): string {
  return x == null || Number.isNaN(Number(x)) ? "—" : "$" + Math.round(Number(x)).toLocaleString("en-US");
}

/** "Tue, Oct 14, 10:00 AM" in the business's time; a dash for nothing. */
export function salesWhen(iso: string | null | undefined, timeZone = SALES_TZ): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "Oct 14" in the business's time; a dash for nothing. */
export function salesDay(iso: string | null | undefined, timeZone = SALES_TZ): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" });
}

/** Words for a status code: "needs_approval" → "Needs approval". */
export function statusWords(code: string | null | undefined): string {
  const s = (code ?? "").replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "—";
}

/**
 * Speed to proposal: from the evaluation being submitted to the client
 * having the proposal in their inbox.
 *
 * The target is under two hours. The figure behind it is vendor-attributed
 * (a 2025 NALP report, as cited by US Tech Automations, not verified against
 * NALP): estimates sent within two hours of the visit close 63% of the time,
 * against 38% the next business day. Even if the gap is half that, it is the
 * biggest lever on close rate the business owns, and the one the old
 * approval gate was working against.
 *
 * Wall-clock hours, not business hours, because that is how the claim is
 * stated and how a client experiences it: a proposal promised "this
 * afternoon" that lands tomorrow morning is a day late to them.
 *
 * Pure, so the timing is tested without a database.
 */

export const DEFAULT_SPEED_TARGET_HOURS = 2;

/** Vendor-attributed NALP figures, for the panel's caption. */
export const SPEED_CLAIM = { fastCloseRate: 0.63, slowCloseRate: 0.38, source: "US Tech Automations, citing NALP 2025 (unverified)" } as const;

const HOUR = 3_600_000;

/** Hours from submitted to sent; null when either is missing or out of order. */
export function hoursToProposal(submittedAt: string | null | undefined, sentAt: string | null | undefined): number | null {
  if (!submittedAt || !sentAt) return null;
  const a = new Date(submittedAt).getTime();
  const b = new Date(sentAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / HOUR;
}

/** Submitted, not sent, and past the target. */
export function isOverdue(submittedAt: string | null | undefined, sentAt: string | null | undefined, now: Date, targetHours = DEFAULT_SPEED_TARGET_HOURS): boolean {
  if (!submittedAt || sentAt) return false;
  const a = new Date(submittedAt).getTime();
  return Number.isFinite(a) && now.getTime() - a > targetHours * HOUR;
}

/** How long it has been waiting, in hours, for the exception's wording. */
export function hoursWaiting(submittedAt: string, now: Date): number {
  return Math.max(0, (now.getTime() - new Date(submittedAt).getTime()) / HOUR);
}

export interface SpeedRow {
  submittedAt: string | null;
  sentAt: string | null;
}

export interface SpeedSummary {
  /** Proposals that went out after a submitted evaluation. */
  sent: number;
  /** Median hours from submitted to sent. */
  medianHours: number | null;
  /** Share of those sent within the target, 0 to 1. */
  withinTarget: number | null;
  /** Share sent the same calendar day, 0 to 1 (the report's ≥90% band). */
  sameDay: number | null;
  /** Submitted and still not sent, past the target now. */
  overdue: number;
}

export function speedSummary(rows: SpeedRow[], now: Date, targetHours = DEFAULT_SPEED_TARGET_HOURS, timeZone = "America/New_York"): SpeedSummary {
  const hours = rows.map((r) => hoursToProposal(r.submittedAt, r.sentAt)).filter((h): h is number => h != null);
  const sentRows = rows.filter((r) => hoursToProposal(r.submittedAt, r.sentAt) != null);
  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  return {
    sent: hours.length,
    medianHours: median(hours),
    withinTarget: hours.length ? hours.filter((h) => h <= targetHours).length / hours.length : null,
    sameDay: sentRows.length ? sentRows.filter((r) => dayOf(r.submittedAt!) === dayOf(r.sentAt!)).length / sentRows.length : null,
    overdue: rows.filter((r) => isOverdue(r.submittedAt, r.sentAt, now, targetHours)).length,
  };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** "45 min", "1.5 h", "2 days": short enough for a tile. */
export function formatHours(hours: number | null): string {
  if (hours == null) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round(hours / 24)} days`;
}

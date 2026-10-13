/**
 * The Monday note to the owner: what is waiting, how last week went per
 * department, and the exceptions worth knowing about.
 *
 * One look on a Monday morning instead of six screens. It is a text first
 * (it goes through notifyTeamMember, which falls back to email), so it is
 * short lines, numbers first, and one link.
 *
 * Pure: no reads, no writes.
 */

import { BUSINESS_TIME_ZONE, dateKeyIn, wallClockIn, zonedToUtc } from "@/lib/time-zone";

/** Monday, 7am on the business's clock. */
export const DIGEST_WEEKDAY = 1;
export const DIGEST_HOUR = 7;

/** Whether a run at this moment is the Monday digest's moment (7am or later, Monday). */
export function isDigestTime(now: Date, timeZone: string = BUSINESS_TIME_ZONE): boolean {
  const w = wallClockIn(now, timeZone);
  return w.weekday === DIGEST_WEEKDAY && w.hour >= DIGEST_HOUR;
}

function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Last week, Monday to Monday on the business's clock: the week that ended
 * at midnight before this Monday. Run on any day, it is the most recent
 * whole week.
 */
export function lastWeek(now: Date, timeZone: string = BUSINESS_TIME_ZONE): { start: Date; end: Date; startKey: string; endKey: string } {
  const w = wallClockIn(now, timeZone);
  const today = dateKeyIn(now, timeZone);
  // Days since this week's Monday (Sunday counts as the end of the week).
  const sinceMonday = (w.weekday + 6) % 7;
  const thisMonday = addDays(today, -sinceMonday);
  const lastMonday = addDays(thisMonday, -7);
  return {
    start: zonedToUtc(lastMonday, "00:00", timeZone),
    end: zonedToUtc(thisMonday, "00:00", timeZone),
    startKey: lastMonday,
    endKey: thisMonday,
  };
}

/** The key one week's digest is sent under, so it goes once. */
export function digestKey(now: Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  return `owner_digest:${lastWeek(now, timeZone).endKey}`;
}

export interface WeekKpis {
  marketing: { leads: number };
  sales: {
    bookedEvaluations: number;
    proposalsSent: number;
    proposalsWon: number;
    proposalsLost: number;
  };
  operations: { jobsCompleted: number };
  admin: {
    invoiced: number;
    collected: number;
    arOverdue: number;
    arOverdueCount: number;
  };
}

/** Won over decided, as a whole percent, or null with nothing decided. */
export function closeRate(won: number, lost: number): number | null {
  const decided = won + lost;
  if (decided <= 0) return null;
  return Math.round((won / decided) * 100);
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function monthDay(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export interface DigestInput {
  businessName: string;
  week: { startKey: string; endKey: string };
  queueCount: number;
  queueByType: { label: string; count: number }[];
  kpis: WeekKpis;
  exceptions: { title: string; detail: string | null }[];
  link: string;
}

/** The note itself: a subject, and the words. */
export function composeDigest(input: DigestInput): { subject: string; text: string } {
  const { kpis } = input;
  const lastDay = addDays(input.week.endKey, -1);
  const range = `${monthDay(input.week.startKey)}–${monthDay(lastDay)}`;
  const rate = closeRate(kpis.sales.proposalsWon, kpis.sales.proposalsLost);

  const waiting =
    input.queueCount === 0
      ? "Nothing is waiting for you."
      : `${input.queueCount} waiting for you: ${input.queueByType
          .filter((t) => t.count > 0)
          .map((t) => `${t.count} ${t.label.toLowerCase()}${t.count === 1 ? "" : "s"}`)
          .join(", ")}.`;

  const lines = [
    `${input.businessName} week of ${range}`,
    waiting,
    "",
    `Marketing: ${kpis.marketing.leads} new lead${kpis.marketing.leads === 1 ? "" : "s"}.`,
    `Sales: ${kpis.sales.bookedEvaluations} evaluation${kpis.sales.bookedEvaluations === 1 ? "" : "s"} booked; ${kpis.sales.proposalsSent} proposal${kpis.sales.proposalsSent === 1 ? "" : "s"} sent, ${kpis.sales.proposalsWon} won, ${kpis.sales.proposalsLost} lost${rate === null ? "" : ` (${rate}% close rate)`}.`,
    `Operations: ${kpis.operations.jobsCompleted} job${kpis.operations.jobsCompleted === 1 ? "" : "s"} completed.`,
    `Admin: ${money(kpis.admin.invoiced)} invoiced, ${money(kpis.admin.collected)} collected; ${kpis.admin.arOverdueCount === 0 ? "nothing overdue" : `${money(kpis.admin.arOverdue)} overdue on ${kpis.admin.arOverdueCount} invoice${kpis.admin.arOverdueCount === 1 ? "" : "s"}`}.`,
  ];
  if (input.exceptions.length > 0) {
    lines.push("", "Top exceptions:");
    for (const e of input.exceptions.slice(0, 5)) lines.push(`- ${e.title}${e.detail ? `: ${e.detail}` : ""}`);
  }
  lines.push("", `Open the queue: ${input.link}`);

  const subject = input.queueCount === 0 ? `Monday digest: ${range}` : `Monday digest: ${input.queueCount} waiting for you`;
  return { subject, text: lines.join("\n") };
}

/** An invoice still open this many days after it went out is overdue. */
export const AR_OVERDUE_DAYS = 30;

export function isOverdue(invoice: { status: string; sentAt: string | null; createdAt: string }, now: Date): boolean {
  if (invoice.status !== "open") return false;
  const from = new Date(invoice.sentAt ?? invoice.createdAt).getTime();
  return now.getTime() - from > AR_OVERDUE_DAYS * 86_400_000;
}

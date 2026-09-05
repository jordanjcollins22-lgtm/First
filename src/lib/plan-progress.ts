/**
 * Where a payment schedule has got to.
 *
 * A plan is a promise with dates on it. What the office needs from a list of
 * them is which promises are behind, and by how much — not a table of every
 * instalment ever agreed.
 *
 * All of it worked out from the instalments and the money recorded against
 * the plan. Nothing here is stored: an instalment is not late the day it is
 * written, it goes late the morning after its due date, and a stored "behind"
 * flag is one that would need a nightly job to stay true.
 */

export interface ScheduleItem {
  id: string;
  number: number;
  amountCents: number;
  dueOn: string;
  isDeposit: boolean;
  status: "due" | "paid" | "failed" | "cancelled";
}

export interface PlanLike {
  id: string;
  totalCents: number;
  paidCents: number;
  status: "offered" | "accepted" | "active" | "settled" | "cancelled";
  schedule: ScheduleItem[];
}

export interface PlanProgress {
  /** Still owed. Never negative — an overpayment is a credit, not a debt. */
  outstandingCents: number;
  /** How far through, 0 to 1. One when there is nothing left to pay. */
  fraction: number;
  /** The next instalment still waiting, or null when none are. */
  next: ScheduleItem | null;
  /** Instalments past their due date and still unpaid. */
  overdue: ScheduleItem[];
  /** What those overdue instalments come to. */
  overdueCents: number;
  settled: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayNumber(iso: string): number | null {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / DAY_MS);
}

/** Waiting on money: due and not cancelled. A failed charge is still owed. */
function stillOwed(item: ScheduleItem): boolean {
  return item.status === "due" || item.status === "failed";
}

export function planProgress(plan: PlanLike, today = new Date()): PlanProgress {
  const outstanding = Math.max(0, plan.totalCents - plan.paidCents);
  const now = dayNumber(today.toISOString().slice(0, 10));

  const waiting = plan.schedule
    .filter(stillOwed)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.number - b.number);

  const overdue = waiting.filter((item) => {
    const due = dayNumber(item.dueOn);
    return due != null && now != null && due < now;
  });

  return {
    outstandingCents: outstanding,
    fraction: plan.totalCents > 0 ? Math.min(1, plan.paidCents / plan.totalCents) : 1,
    next: waiting[0] ?? null,
    overdue,
    overdueCents: overdue.reduce((sum, item) => sum + item.amountCents, 0),
    // Settled means the money is in, whatever the row says. A plan marked
    // active that has been paid off in full is paid off.
    settled: plan.status === "settled" || outstanding === 0,
  };
}

export interface PlansSummary {
  plans: number;
  /** Plans with money still to come. */
  running: number;
  behind: number;
  owedCents: number;
  overdueCents: number;
}

export function summarisePlans(plans: PlanLike[], today = new Date()): PlansSummary {
  const summary: PlansSummary = {
    plans: plans.length,
    running: 0,
    behind: 0,
    owedCents: 0,
    overdueCents: 0,
  };

  for (const plan of plans) {
    // A cancelled plan is not money anybody is waiting for. Counting it as
    // owed would put a number on the screen that will never arrive.
    if (plan.status === "cancelled") continue;

    const progress = planProgress(plan, today);
    if (progress.settled) continue;

    summary.running += 1;
    summary.owedCents += progress.outstandingCents;
    if (progress.overdue.length > 0) {
      summary.behind += 1;
      summary.overdueCents += progress.overdueCents;
    }
  }

  return summary;
}

/** The line above the list. Leads with what is behind, because that is the
 * only part anybody has to act on today. */
export function plansLine(summary: PlansSummary): string {
  if (summary.plans === 0) return "No payment schedules yet.";

  const money = (c: number) =>
    (c / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });

  if (summary.running === 0) return "Every schedule is paid off.";

  const parts = [`${money(summary.owedCents)} still to come across ${summary.running}`];
  if (summary.behind > 0) {
    parts.push(`${summary.behind} behind by ${money(summary.overdueCents)}`);
  }
  return `${parts.join(", ")}.`;
}

/** Behind first, then by what is due soonest. The order is the work queue. */
export function byPlanUrgency<T extends PlanLike>(plans: T[], today = new Date()): T[] {
  return [...plans].sort((a, b) => {
    const pa = planProgress(a, today);
    const pb = planProgress(b, today);

    // Paid off and cancelled sink; there is nothing to do about either.
    const rank = (p: PlanProgress, plan: PlanLike) =>
      plan.status === "cancelled" ? 3 : p.settled ? 2 : p.overdue.length > 0 ? 0 : 1;

    const byRank = rank(pa, a) - rank(pb, b);
    if (byRank !== 0) return byRank;

    if (!pa.next && !pb.next) return 0;
    if (!pa.next) return 1;
    if (!pb.next) return -1;
    return pa.next.dueOn.localeCompare(pb.next.dueOn);
  });
}

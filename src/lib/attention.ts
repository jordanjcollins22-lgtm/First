/**
 * Why a job is in Needs attention.
 *
 * Two kinds of reason, and they are kept apart on purpose.
 *
 * An **issue** is somebody saying there is a problem. It is a record with an
 * author, and it stays until it is resolved.
 *
 * A **derived reason** is the app noticing something about the state of the
 * job: it starts on Tuesday and is still not ready, the field work finished
 * eight days ago and nothing has closed it, the bill went out a month ago and
 * nobody has been paid. Nothing is written down for these. They appear when
 * the condition is true and vanish when it stops being true, which is the
 * whole point -- an automatically-raised issue is an issue somebody has to
 * remember to close, and they never do.
 *
 * The screen always says which it is and why.
 */

import { needsAttention, type Issue } from "@/lib/issues";

export type AttentionKind =
  | "blocking-issue"
  | "critical-issue"
  | "starting-not-ready"
  | "confirmations-overdue"
  | "closeout-overdue"
  | "payment-overdue";

export interface AttentionReason {
  kind: AttentionKind;
  /** One line, in the words somebody would use about it. */
  says: string;
  /** Worse sorts first. */
  rank: number;
}

export interface AttentionFacts {
  status: string;
  /** The job's start date, if it has one. */
  startsOn: string | null;
  /** Whether every applicable blocking pre-start check passes right now. */
  ready: boolean;
  /** When the field work was finished, if it has been. */
  completedAt: string | null;
  /** Whether the closeout gate is open. */
  closeoutDone: boolean;
  /** Money still owed on the job, or null when there is no invoice. */
  balanceOutstanding: number | null;
  /** When the invoice went out. */
  invoicedAt: string | null;
  /** Set when somebody has decided what happens about the balance. */
  financialDisposition: string | null;
}

/** How long a thing is allowed to sit before it is worth somebody's attention. */
export const DAYS_BEFORE_START_MUST_BE_READY = 3;
export const DAYS_BEFORE_CLOSEOUT_IS_LATE = 7;
export const DAYS_BEFORE_PAYMENT_IS_CHASED = 14;

/**
 * Whole days between two moments, counted the way a person counts them.
 *
 * Calendar days, not elapsed twenty-four-hour periods: a job at eight in the
 * morning the day after tomorrow starts "in two days", not in one and a half.
 * Both moments are reduced to their date first.
 */
function daysBetween(from: string, to: string): number {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((day(b) - day(a)) / 86_400_000);
}

/**
 * Every reason this job wants looking at, worst first.
 *
 * An empty list means it does not belong in Needs attention at all.
 */
export function attentionReasons(
  facts: AttentionFacts,
  issues: readonly Issue[],
  now: string
): AttentionReason[] {
  const reasons: AttentionReason[] = [];

  const open = issues.filter((issue) => issue.status === "open");
  const stopping = open.filter((issue) => issue.blocking);
  const critical = open.filter((issue) => issue.severity === "critical" && !issue.blocking);

  if (stopping.length > 0) {
    reasons.push({
      kind: "blocking-issue",
      says: `${stopping.length} open ${stopping.length === 1 ? "issue is" : "issues are"} stopping this job`,
      rank: 0,
    });
  }
  if (critical.length > 0) {
    reasons.push({
      kind: "critical-issue",
      says: `${critical.length} critical ${critical.length === 1 ? "issue" : "issues"} open`,
      rank: 1,
    });
  }

  // Starting soon and still not ready. Only for sold work with a date on it:
  // a job nobody has scheduled is not late, it is unscheduled.
  if (facts.status === "approved" && facts.startsOn && !facts.ready) {
    const days = daysBetween(now, facts.startsOn);
    if (days <= DAYS_BEFORE_START_MUST_BE_READY) {
      reasons.push({
        kind: days < 0 ? "confirmations-overdue" : "starting-not-ready",
        says:
          days < 0
            ? `Should have started ${-days} ${-days === 1 ? "day" : "days"} ago and is still not ready`
            : days === 0
              ? "Starts today and is still not ready"
              : `Starts in ${days} ${days === 1 ? "day" : "days"} and is still not ready`,
        rank: days <= 0 ? 2 : 3,
      });
    }
  }

  // Field work finished, nothing closed it.
  if (facts.completedAt && !facts.closeoutDone) {
    const days = daysBetween(facts.completedAt, now);
    if (days >= DAYS_BEFORE_CLOSEOUT_IS_LATE) {
      reasons.push({
        kind: "closeout-overdue",
        says: `Field work finished ${days} days ago and closeout is not done`,
        rank: 4,
      });
    }
  }

  // Money owed after the work is finished. It does not stop the job being
  // Completed -- the landscaping really is done -- but it does not get to
  // disappear either, and it goes quiet only when somebody records what is
  // happening about it.
  if (
    facts.balanceOutstanding != null &&
    facts.balanceOutstanding > 0 &&
    facts.financialDisposition == null
  ) {
    const days = facts.invoicedAt ? daysBetween(facts.invoicedAt, now) : 0;
    if (days >= DAYS_BEFORE_PAYMENT_IS_CHASED) {
      reasons.push({
        kind: "payment-overdue",
        says: `Unpaid ${days} days after invoicing`,
        rank: 5,
      });
    } else if (facts.status === "completed") {
      reasons.push({ kind: "payment-overdue", says: "Work finished, payment still due", rank: 6 });
    }
  }

  return reasons.sort((a, b) => a.rank - b.rank);
}

/** Whether the job belongs in Needs attention at all. */
export function wantsAttention(facts: AttentionFacts, issues: readonly Issue[], now: string): boolean {
  return needsAttention(issues) || attentionReasons(facts, issues, now).length > 0;
}

export const DISPOSITION_LABEL: Record<string, string> = {
  waived: "Waived",
  written_off: "Written off",
  refunded: "Refunded",
  payment_plan: "On a payment plan",
  disputed: "Disputed",
  collections: "With collections",
};

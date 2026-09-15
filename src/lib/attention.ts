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
  | "crew-stopped"
  | "blocking-issue"
  | "critical-issue"
  | "starting-not-ready"
  | "confirmations-overdue"
  | "change-awaiting-review"
  | "exception-unanswered"
  | "closeout-overdue"
  | "change-awaiting-client"
  | "payment-overdue";

/**
 * How urgent each kind is, spaced so a new one can be put between two
 * existing ones without renumbering the lot.
 *
 * A crew standing in a garden is the top of the list and always will be: it is
 * the only reason here that is costing money by the minute.
 */
const RANK: Record<AttentionKind, number> = {
  "crew-stopped": 0,
  "blocking-issue": 10,
  "critical-issue": 20,
  "confirmations-overdue": 30,
  "change-awaiting-review": 35,
  "starting-not-ready": 40,
  "exception-unanswered": 45,
  "closeout-overdue": 50,
  "change-awaiting-client": 55,
  "payment-overdue": 60,
};

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
  /** Open exceptions where the person who reported it said they are stopped. */
  crewStopped?: number;
  /** Open exceptions of any kind, stopped or not. */
  openExceptions?: number;
  /** Change requests sitting on an account manager's desk. */
  changesAwaitingReview?: number;
  /** Change requests sitting with the client. */
  changesAwaitingClient?: number;
  /** When the oldest of those went out, so silence can be aged. */
  oldestSentToClientAt?: string | null;
}

/** How long a thing is allowed to sit before it is worth somebody's attention. */
export const DAYS_BEFORE_START_MUST_BE_READY = 3;
export const DAYS_BEFORE_CLOSEOUT_IS_LATE = 7;
export const DAYS_BEFORE_PAYMENT_IS_CHASED = 14;
/** A change request the client has not answered stops being "sent" and starts being "ignored". */
export const DAYS_BEFORE_A_CHANGE_IS_CHASED = 3;

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

  // A crew is standing in a garden, unable to work. Above everything else,
  // because it is the only thing here costing money by the minute.
  const stopped = facts.crewStopped ?? 0;
  if (stopped > 0) {
    reasons.push({
      kind: "crew-stopped",
      says: stopped === 1 ? "A crew is stopped on site" : `${stopped} reports say a crew is stopped on site`,
      rank: RANK["crew-stopped"],
    });
  }

  const open = issues.filter((issue) => issue.status === "open");
  const stopping = open.filter((issue) => issue.blocking);
  const critical = open.filter((issue) => issue.severity === "critical" && !issue.blocking);

  if (stopping.length > 0) {
    reasons.push({
      kind: "blocking-issue",
      says: `${stopping.length} open ${stopping.length === 1 ? "issue is" : "issues are"} stopping this job`,
      rank: RANK["blocking-issue"],
    });
  }
  if (critical.length > 0) {
    reasons.push({
      kind: "critical-issue",
      says: `${critical.length} critical ${critical.length === 1 ? "issue" : "issues"} open`,
      rank: RANK["critical-issue"],
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
        rank: days <= 0 ? RANK["confirmations-overdue"] : RANK["starting-not-ready"],
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
        rank: RANK["closeout-overdue"],
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
        rank: RANK["payment-overdue"],
      });
    } else if (facts.status === "completed") {
      reasons.push({ kind: "payment-overdue", says: "Work finished, payment still due", rank: RANK["payment-overdue"] });
    }
  }

  // Somebody in the field is waiting on a decision. A change request nobody
  // has picked up is the one that turns into a phone call to the owner, which
  // is the thing this whole system exists to stop.
  const forReview = facts.changesAwaitingReview ?? 0;
  if (forReview > 0) {
    reasons.push({
      kind: "change-awaiting-review",
      says:
        forReview === 1
          ? "A change request is waiting to be reviewed"
          : `${forReview} change requests are waiting to be reviewed`,
      rank: RANK["change-awaiting-review"],
    });
  }

  // Open reports that are not a stopped crew and not a change request: a
  // broken mower, a late start, materials that turned up wrong. Counted rather
  // than listed, because at this level the question is which job needs
  // somebody, not what exactly happened on it.
  const otherOpen = Math.max(0, (facts.openExceptions ?? 0) - stopped - forReview);
  if (otherOpen > 0) {
    reasons.push({
      kind: "exception-unanswered",
      says: otherOpen === 1 ? "A field report has not been answered" : `${otherOpen} field reports have not been answered`,
      rank: RANK["exception-unanswered"],
    });
  }

  // The client has had it for days and said nothing. Only aged: a change sent
  // this morning is not a problem, it is a change that was sent this morning.
  const withClient = facts.changesAwaitingClient ?? 0;
  if (withClient > 0 && facts.oldestSentToClientAt) {
    const days = daysBetween(facts.oldestSentToClientAt, now);
    if (days >= DAYS_BEFORE_A_CHANGE_IS_CHASED) {
      reasons.push({
        kind: "change-awaiting-client",
        says: `A change request has been with the client ${days} days`,
        rank: RANK["change-awaiting-client"],
      });
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

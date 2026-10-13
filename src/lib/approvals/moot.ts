/**
 * When an automatic email has stopped making sense.
 *
 * The declined emails were not random. Read against the jobs behind them:
 *
 * - 10 of the 15 declined "after the visit" emails were written after the
 *   proposal had already gone to the client. That email says "we put your
 *   proposal together, usually within a day or two", which is wrong by then.
 * - 8 of the 15 declined proposal follow-ups were for proposals somebody had
 *   already phoned the client about, and 2 more had been answered before the
 *   owner got to them.
 * - Held emails stayed held after the booking was cancelled or the visit
 *   moved, and an email approved later would go out with the old date.
 * - A visit booked in the app and again through GoHighLevel is two jobs for
 *   one person at one time, and each wrote its own sequence.
 *
 * Each of those is a rule here. A due email that is moot is closed unsent
 * with the reason written down; a held one is closed before anybody is asked
 * about it; and an approved one is checked again before it goes.
 *
 * Pure: no reads, no writes.
 */

export type MootReason =
  | "booking_cancelled"
  | "visit_moved"
  | "visit_passed"
  | "proposal_already_sent"
  | "proposal_answered"
  | "already_called"
  | "duplicate_booking"
  | "job_done";

export const MOOT_LABEL: Record<MootReason, string> = {
  booking_cancelled: "The booking was cancelled.",
  visit_moved: "The visit moved after this was written.",
  visit_passed: "The visit has already happened.",
  proposal_already_sent: "The proposal had already gone to the client.",
  proposal_answered: "The client already answered the proposal.",
  already_called: "Somebody already called the client about this proposal.",
  duplicate_booking: "The same visit is booked twice; only the first booking emails.",
  job_done: "The job is already finished.",
};

export interface MootJob {
  id: string;
  status: string | null;
  evaluationStatus: string | null;
  cancelledAt: string | null;
  evaluationDate: string | null;
  completedAt?: string | null;
}

export interface MootFacts {
  kind: string;
  job: MootJob | null;
  /** The visit time the email was written for, when it recorded one. */
  writtenForEvaluationAt?: string | null;
  /** The proposal it is about: the job's, or the one a follow-up names. */
  proposal?: { status: string; sentAt: string | null } | null;
  /** Calls logged about the proposal since it was sent. */
  callsSinceSent?: number;
  /** The job this one duplicates, when it is a second booking of one visit. */
  duplicateOf?: string | null;
}

/** Emails about a visit that has not happened yet. */
const BEFORE_VISIT = new Set([
  "evaluation_booked",
  "evaluation_confirmed",
  "evaluation_two_days",
  "evaluation_day_before",
  "evaluation_reminder",
  "evaluation_morning_of",
]);

export function isBeforeVisitKind(kind: string): boolean {
  return BEFORE_VISIT.has(kind);
}

function isEvaluationKind(kind: string): boolean {
  return kind.startsWith("evaluation_");
}

export function isCancelledJob(job: MootJob): boolean {
  return Boolean(job.cancelledAt) || job.status === "cancelled" || job.evaluationStatus === "cancelled";
}

const MINUTE = 60_000;

/** Why this email should not go, or null when it still should. */
export function mootReason(facts: MootFacts, now: Date): MootReason | null {
  const { kind, job } = facts;

  if (isEvaluationKind(kind)) {
    if (job && isCancelledJob(job)) return "booking_cancelled";
    if (facts.duplicateOf) return "duplicate_booking";
    if (job && BEFORE_VISIT.has(kind) && job.evaluationDate) {
      const at = new Date(job.evaluationDate).getTime();
      if (facts.writtenForEvaluationAt) {
        const written = new Date(facts.writtenForEvaluationAt).getTime();
        if (Number.isFinite(written) && Math.abs(written - at) > MINUTE) return "visit_moved";
      }
      if (at <= now.getTime()) return "visit_passed";
    }
    if (kind === "evaluation_after" && facts.proposal?.sentAt) return "proposal_already_sent";
    return null;
  }

  if (kind === "proposal_follow_up") {
    if (job && job.status === "cancelled") return "booking_cancelled";
    if (job?.cancelledAt) return "booking_cancelled";
    if (facts.proposal && facts.proposal.status !== "sent") return "proposal_answered";
    if ((facts.callsSinceSent ?? 0) > 0) return "already_called";
    return null;
  }

  if (kind === "job_start_reminder") {
    if (job && (job.status === "cancelled" || job.cancelledAt)) return "booking_cancelled";
    if (job && (job.completedAt || job.status === "completed")) return "job_done";
    return null;
  }

  return null;
}

export interface BookingForDuplicates {
  id: string;
  email: string | null;
  evaluationDate: string | null;
  createdAt: string;
  cancelled: boolean;
  /** Somebody said this one is more work, not a copy. */
  duplicateClearedAt?: string | null;
}

/** Two bookings this close together for one person are one visit. */
export const SAME_VISIT_WINDOW_MS = 2 * 60 * MINUTE;

/**
 * Which live bookings are a second copy of another, and of which.
 *
 * Same email, visits within two hours of each other, neither cancelled nor
 * vouched for. The first one booked keeps its emails; the copy sends none.
 * Different from the board's duplicate check (same address and name), because
 * a GoHighLevel copy often arrives as a new client record with the same email.
 */
export function duplicateBookings(bookings: readonly BookingForDuplicates[]): Map<string, string> {
  const live = bookings.filter((b) => !b.cancelled && !b.duplicateClearedAt && b.email && b.evaluationDate);
  const byEmail = new Map<string, BookingForDuplicates[]>();
  for (const b of live) {
    const key = b.email!.trim().toLowerCase();
    byEmail.set(key, [...(byEmail.get(key) ?? []), b]);
  }
  const copies = new Map<string, string>();
  for (const group of byEmail.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (let i = 1; i < ordered.length; i++) {
      const copy = ordered[i];
      const at = new Date(copy.evaluationDate!).getTime();
      const keeper = ordered
        .slice(0, i)
        .find((k) => !copies.has(k.id) && Math.abs(new Date(k.evaluationDate!).getTime() - at) <= SAME_VISIT_WINDOW_MS);
      if (keeper) copies.set(copy.id, keeper.id);
    }
  }
  return copies;
}

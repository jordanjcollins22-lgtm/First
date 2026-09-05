/**
 * One person's own work, looking forward.
 *
 * The dashboard answers "what is the business doing"; My Day answered "what is
 * on me today". Neither answered the two questions somebody running this
 * business actually opens their phone with: what have I got coming, and what
 * do I still owe somebody.
 *
 * That second one is the whole point of this module. Evaluations do not go
 * wrong by being missed — somebody drives out, looks at the yard, and then the
 * write-up sits in their head for a week. There is no screen anywhere that
 * says "you visited this on Tuesday and nobody has priced it", because the job
 * looks perfectly healthy from every other angle. This finds those.
 *
 * Derived from the same job rows as everything else, so it cannot disagree
 * with the pipeline, the dashboard, or the job page.
 */

import { dayKey, dayKeyOf, jobBucket, type DashboardJobInput, type JobBucket } from "@/lib/dashboard";

/** Why a job is sitting in somebody's queue rather than moving. */
export type SubmitReason = "close_out" | "price_it" | "send_it";

export const SUBMIT_LABELS: Record<SubmitReason, string> = {
  close_out: "Close out the visit",
  price_it: "Price it and build the proposal",
  send_it: "Send the proposal",
};

export const SUBMIT_BLURBS: Record<SubmitReason, string> = {
  close_out: "You went out, but the visit was never marked complete — so nothing downstream has unlocked.",
  price_it: "Evaluated, and nobody has priced it yet.",
  send_it: "Priced and sitting there. The client hasn't seen it.",
};

export interface UpcomingEvaluation {
  jobId: string;
  customerName: string;
  address: string;
  /** The appointment itself, as stored. */
  at: string;
  /** Local day it falls on, for grouping. */
  day: string;
  /** scheduled, on_way or arrived. */
  status: string;
  isToday: boolean;
}

export interface SubmissionDue {
  jobId: string;
  customerName: string;
  address: string;
  reason: SubmitReason;
  /** The day the clock started — the visit date, or when it was evaluated. */
  since: string | null;
  /** Whole days it has been sitting. Null when there is no date to count from. */
  daysWaiting: number | null;
}

export interface ManagedJob {
  jobId: string;
  customerName: string;
  address: string;
  bucket: JobBucket;
  date: string | null;
  value: number | null;
}

export interface MyWork {
  upcoming: UpcomingEvaluation[];
  submissions: SubmissionDue[];
  managed: ManagedJob[];
}

/** The order the piles read in: the longest-waiting problem first. */
const SUBMIT_ORDER: Record<SubmitReason, number> = { close_out: 0, price_it: 1, send_it: 2 };

/** States that mean a job is live work somebody is managing. Finished and
 * cancelled are not "ongoing", and a job still out for a decision is the
 * client's move, not theirs. */
const ONGOING: JobBucket[] = ["working", "needs_signoff", "scheduled", "unscheduled"];

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * Everything on one person's plate.
 *
 * The caller filters the jobs to theirs — this does not know or care whose
 * they are, which keeps it testable and lets the same code serve an admin, an
 * account manager, or a roll-up of somebody else's book.
 */
export function buildMyWork(jobs: DashboardJobInput[], today: Date = new Date()): MyWork {
  const todayKey = dayKey(today);

  const upcoming: UpcomingEvaluation[] = [];
  const submissions: SubmissionDue[] = [];
  const managed: ManagedJob[] = [];

  for (const job of jobs) {
    if (job.status === "cancelled") continue;

    const evalKey = dayKeyOf(job.evaluationDate);
    const evaluated = job.evaluationStatus === "completed";
    const visitOpen = !evaluated && job.evaluationStatus !== "cancelled";

    // Coming up: a visit that has not happened yet, today included. Today is
    // upcoming right up until it is over.
    if (job.evaluationDate && evalKey && visitOpen && evalKey >= todayKey) {
      upcoming.push({
        jobId: job.id,
        customerName: job.customerName,
        address: job.address,
        at: job.evaluationDate,
        day: evalKey,
        status: job.evaluationStatus,
        isToday: evalKey === todayKey,
      });
    }

    // Owed. Checked in the order work moves, and only the first one that
    // applies — telling somebody to price a job they have not closed out yet
    // is two instructions for one action.
    if (job.evaluationDate && evalKey && visitOpen && evalKey < todayKey) {
      submissions.push({
        jobId: job.id,
        customerName: job.customerName,
        address: job.address,
        reason: "close_out",
        since: evalKey,
        daysWaiting: daysBetween(evalKey, todayKey),
      });
    } else if (evaluated && job.proposalStatus === null && job.status !== "completed") {
      submissions.push({
        jobId: job.id,
        customerName: job.customerName,
        address: job.address,
        reason: "price_it",
        since: evalKey,
        daysWaiting: evalKey ? daysBetween(evalKey, todayKey) : null,
      });
    } else if (job.proposalStatus === "needs_approval") {
      submissions.push({
        jobId: job.id,
        customerName: job.customerName,
        address: job.address,
        reason: "send_it",
        since: evalKey,
        daysWaiting: evalKey ? daysBetween(evalKey, todayKey) : null,
      });
    }

    const bucket = jobBucket(job, todayKey);
    if (bucket && ONGOING.includes(bucket)) {
      managed.push({
        jobId: job.id,
        customerName: job.customerName,
        address: job.address,
        bucket,
        date: dayKeyOf(job.projectStartDate) ?? dayKeyOf(job.projectEndDate),
        value: job.value,
      });
    }
  }

  upcoming.sort((a, b) => (a.at === b.at ? a.customerName.localeCompare(b.customerName) : a.at < b.at ? -1 : 1));

  submissions.sort((a, b) => {
    if (SUBMIT_ORDER[a.reason] !== SUBMIT_ORDER[b.reason]) {
      return SUBMIT_ORDER[a.reason] - SUBMIT_ORDER[b.reason];
    }
    // Longest wait first inside a reason — that is the one going cold.
    return (b.daysWaiting ?? -1) - (a.daysWaiting ?? -1);
  });

  const managedOrder: Record<string, number> = {
    working: 0,
    needs_signoff: 1,
    scheduled: 2,
    unscheduled: 3,
  };
  managed.sort((a, b) => {
    if (managedOrder[a.bucket] !== managedOrder[b.bucket]) {
      return managedOrder[a.bucket] - managedOrder[b.bucket];
    }
    if (a.date === b.date) return a.customerName.localeCompare(b.customerName);
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? -1 : 1;
  });

  return { upcoming, submissions, managed };
}

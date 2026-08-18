/**
 * What can happen to a job, and when.
 *
 * Kept away from the server actions so the rules can be tested without a
 * database, and so the UI can grey out a button using exactly the same
 * reasoning the action will apply when it runs.
 */

import type { EvaluationStatus, JobPhotoKind, JobStatus } from "@/types/domain";

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  estimating: "Estimating",
  quoted: "Quoted",
  approved: "Approved",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const EVALUATION_STATUS_LABELS: Record<EvaluationStatus, string> = {
  scheduled: "Scheduled",
  on_way: "On the way",
  arrived: "Arrived",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Statuses that mean the work is over, one way or the other. */
export const CLOSED_STATUSES: JobStatus[] = ["completed", "cancelled"];

export function isClosed(status: JobStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

export interface JobShape {
  status: JobStatus;
  evaluationStatus: EvaluationStatus;
  evaluationDate: string | null;
  projectStartDate: string | null;
  projectEndDate: string | null;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

const ALLOWED: Verdict = { ok: true };

/**
 * Whether an estimate visit can be cancelled.
 *
 * A visit that already happened is history, not a plan — cancelling it would
 * erase a real event. Cancel the job instead.
 */
export function canCancelEstimate(job: JobShape): Verdict {
  if (job.evaluationDate == null) return { ok: false, reason: "There's no estimate scheduled to cancel." };
  if (job.evaluationStatus === "cancelled") return { ok: false, reason: "That estimate is already cancelled." };
  if (job.evaluationStatus === "completed") {
    return { ok: false, reason: "That estimate already happened — cancel the job instead." };
  }
  return ALLOWED;
}

/** Whether the estimate visit can be moved to a different day. */
export function canRescheduleEstimate(job: JobShape): Verdict {
  if (job.status === "cancelled") return { ok: false, reason: "This job is cancelled. Reopen it first." };
  if (job.evaluationStatus === "completed") {
    return { ok: false, reason: "That estimate already happened — it can't be moved." };
  }
  return ALLOWED;
}

export function canCancelJob(job: JobShape): Verdict {
  if (job.status === "cancelled") return { ok: false, reason: "This job is already cancelled." };
  if (job.status === "completed") {
    return { ok: false, reason: "This job is finished. Cancelling it now would erase completed work." };
  }
  return ALLOWED;
}

export function canReopenJob(job: JobShape): Verdict {
  if (job.status !== "cancelled") return { ok: false, reason: "This job isn't cancelled." };
  return ALLOWED;
}

/** Whether the work dates can be moved. */
export function canRescheduleJob(job: JobShape): Verdict {
  if (job.status === "cancelled") return { ok: false, reason: "This job is cancelled. Reopen it first." };
  if (job.status === "completed") return { ok: false, reason: "This job is finished." };
  return ALLOWED;
}

/**
 * Validates a start/end pair.
 *
 * Both blank is allowed — that's how work gets taken off the calendar without
 * cancelling it. An end before its start never is.
 */
export function validateDateRange(start: string | null, end: string | null): Verdict {
  if (start && end && end < start) return { ok: false, reason: "The end date is before the start date." };
  if (!start && end) return { ok: false, reason: "Give it a start date as well as an end date." };
  return ALLOWED;
}

/**
 * The status a job should land on when its estimate is cancelled.
 *
 * A job still being estimated has nothing else holding it up, so it closes
 * too. One already quoted or approved carries a real proposal, so only the
 * visit goes and the job stays alive.
 */
export function statusAfterEstimateCancelled(status: JobStatus): JobStatus {
  return status === "estimating" ? "cancelled" : status;
}

/**
 * Where a reopened job should land.
 *
 * Back to the earliest stage that still matches what exists: a job with work
 * dates was scheduled, one with a finished estimate was quoted, anything else
 * starts over.
 */
export function statusAfterReopen(job: Pick<JobShape, "evaluationStatus" | "projectStartDate">): JobStatus {
  if (job.projectStartDate) return "approved";
  if (job.evaluationStatus === "completed") return "quoted";
  return "estimating";
}

/* -------------------------------------------------------------- completion */

export const PHOTO_KIND_LABELS: Record<JobPhotoKind, string> = {
  before: "Before",
  after: "After",
  issue: "Issue",
};

/**
 * How many photos a job has to carry before it can be signed off.
 *
 * One is the honest minimum: the point of the requirement is that somebody
 * stood on the finished site and looked at it, and demanding a fixed number
 * only teaches people to shoot the same hedge four times.
 */
export const REQUIRED_COMPLETION_PHOTOS = 1;

/**
 * Whether a job can be marked complete.
 *
 * The photo requirement counts 'after' shots specifically. A before photo and
 * a photo of a problem are both worth having, but neither one is evidence the
 * work got done, which is the whole thing being claimed here.
 */
export function canCompleteJob(
  job: Pick<JobShape, "status">,
  photos: { kind: JobPhotoKind }[]
): Verdict {
  if (job.status === "completed") return { ok: false, reason: "This job is already marked complete." };
  if (job.status === "cancelled") return { ok: false, reason: "This job is cancelled. Reopen it first." };

  const after = photos.filter((p) => p.kind === "after").length;
  if (after < REQUIRED_COMPLETION_PHOTOS) {
    return {
      ok: false,
      reason:
        after === 0
          ? "Add at least one 'after' photo before signing this off."
          : `Add ${REQUIRED_COMPLETION_PHOTOS - after} more 'after' photo.`,
    };
  }
  return ALLOWED;
}

/** Whether a completed job can be put back to in-progress, for the callback
 * case — the work was signed off and then something needed redoing. */
export function canReopenCompleted(job: Pick<JobShape, "status">): Verdict {
  if (job.status !== "completed") return { ok: false, reason: "This job isn't marked complete." };
  return ALLOWED;
}

/**
 * What can happen to a job, and when.
 *
 * Kept away from the server actions so the rules can be tested without a
 * database, and so the UI can grey out a button using exactly the same
 * reasoning the action will apply when it runs.
 */

import { REQUIRED_STAGES } from "@/types/domain";
import type { EvaluationStatus, JobPhotoKind, JobPhotoStage, JobStatus } from "@/types/domain";

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
  evaluationEndDate?: string | null;
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

/**
 * Whether the job's work can be moved at all.
 *
 * The dates themselves are derived from the job's visits now, so this guards
 * booking and moving a visit rather than editing a pair of columns.
 */
export function canRescheduleJob(job: Pick<JobShape, "status">): Verdict {
  if (job.status === "cancelled") return { ok: false, reason: "This job is cancelled. Reopen it first." };
  if (job.status === "completed") return { ok: false, reason: "This job is finished." };
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
  during: "During",
  after: "After",
  issue: "Issue",
};

export interface PhotoRecord {
  kind: JobPhotoKind;
  /** Null means the photo is about the job as a whole, not one zone. */
  zoneId: string | null;
}

export interface ZoneRef {
  id: string;
  name: string;
}

export interface ZoneCoverage {
  zoneId: string;
  zoneName: string;
  /** Which of the three stages this zone has at least one photo of. */
  have: Record<JobPhotoStage, boolean>;
  missing: JobPhotoStage[];
  complete: boolean;
}

/**
 * What each zone still owes.
 *
 * Only photos tagged with the zone count toward it. A job-wide photo says
 * something happened somewhere, which is exactly the ambiguity per-zone
 * documentation exists to remove.
 */
export function zoneCoverage(zones: ZoneRef[], photos: PhotoRecord[]): ZoneCoverage[] {
  return zones.map((zone) => {
    const mine = photos.filter((p) => p.zoneId === zone.id);
    const have = {
      before: mine.some((p) => p.kind === "before"),
      during: mine.some((p) => p.kind === "during"),
      after: mine.some((p) => p.kind === "after"),
    };
    const missing = REQUIRED_STAGES.filter((stage) => !have[stage]);
    return { zoneId: zone.id, zoneName: zone.name, have, missing, complete: missing.length === 0 };
  });
}

/**
 * Whether a job can be marked complete.
 *
 * Every zone needs a before, a during and an after. 'during' is the stage
 * nobody can go back for once the ground is closed up, which is what makes it
 * worth enforcing rather than merely encouraging.
 *
 * A job with no zones cannot be signed off at all. There is no such thing as a
 * photo of a whole job — you cannot stand anywhere and capture it — which is
 * the entire reason the work is divided into zones in the first place. A
 * job-wide "after" shot proves somebody pointed a camera at something, and
 * accepting it as evidence would quietly undo the point of the requirement.
 */
export function canCompleteJob(
  job: Pick<JobShape, "status">,
  photos: PhotoRecord[],
  zones: ZoneRef[] = []
): Verdict {
  if (job.status === "completed") return { ok: false, reason: "This job is already marked complete." };
  if (job.status === "cancelled") return { ok: false, reason: "This job is cancelled. Reopen it first." };

  if (zones.length === 0) {
    return {
      ok: false,
      reason: "Draw the zones first — photos are per zone, and there's no photo of a whole job.",
    };
  }

  const gaps = zoneCoverage(zones, photos).filter((z) => !z.complete);
  if (gaps.length === 0) return ALLOWED;

  // Name the specific zone when there is only one gap; past that a list is
  // longer than the panel and the per-zone checklist is already showing it.
  if (gaps.length === 1) {
    const zone = gaps[0];
    return {
      ok: false,
      reason: `${zone.zoneName} still needs ${zone.missing.map((m) => PHOTO_KIND_LABELS[m].toLowerCase()).join(" and ")}.`,
    };
  }
  return {
    ok: false,
    reason: `${gaps.length} zones still need photos.`,
  };
}

/** Whether a completed job can be put back to in-progress, for the callback
 * case — the work was signed off and then something needed redoing. */
export function canReopenCompleted(job: Pick<JobShape, "status">): Verdict {
  if (job.status !== "completed") return { ok: false, reason: "This job isn't marked complete." };
  return ALLOWED;
}

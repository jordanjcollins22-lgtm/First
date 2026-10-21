/**
 * The job's lifecycle as one compact number, and which way it may move.
 *
 * The same mapping as the job_workflow_stage view (migration 0371), so a
 * screen and a query never disagree. The number summarises; it never stands
 * in for the records it is read from. Materials, crew and money run in
 * parallel beside it, each read from its own record.
 */

export const STAGE = {
  NEW_LEAD: 0,
  APPOINTMENT_SCHEDULED: 1,
  ESTIMATE_PREPARATION: 2,
  APPROVED_AWAITING_SCHEDULING: 3,
  JOB_IN_PROGRESS: 4,
  INSPECTION_AND_COMPLETION: 5,
  AWAITING_PAYMENT: 6,
  CLOSED: 7,
  CANCELED: 8,
} as const;

export type StageCode = (typeof STAGE)[keyof typeof STAGE];

export interface StageJob {
  status: string;
  evaluationStatus: string | null;
  evaluationDate: string | null;
  paidInFull: boolean;
}

export function stageOf(job: StageJob): StageCode {
  switch (job.status) {
    case "cancelled":
      return STAGE.CANCELED;
    case "completed":
      return job.paidInFull ? STAGE.CLOSED : STAGE.AWAITING_PAYMENT;
    case "in_progress":
      return STAGE.JOB_IN_PROGRESS;
    case "approved":
      return STAGE.APPROVED_AWAITING_SCHEDULING;
    case "quoted":
      return STAGE.ESTIMATE_PREPARATION;
  }
  if (job.evaluationStatus === "completed") return STAGE.ESTIMATE_PREPARATION;
  if (job.evaluationDate && ["scheduled", "on_way", "arrived"].includes(job.evaluationStatus ?? "")) {
    return STAGE.APPOINTMENT_SCHEDULED;
  }
  return STAGE.NEW_LEAD;
}

/**
 * Moves the lifecycle allows. Forward one step or more is normal (a phone
 * booking can skip straight to a price); backward is allowed only where the
 * business really goes backward: a reopened job, a price withdrawn, a visit
 * that has to be booked again. Anything may be cancelled; a cancelled job
 * only comes back to where it can be worked again.
 */
const BACKWARD: Partial<Record<StageCode, StageCode[]>> = {
  [STAGE.ESTIMATE_PREPARATION]: [STAGE.APPOINTMENT_SCHEDULED],
  [STAGE.APPROVED_AWAITING_SCHEDULING]: [STAGE.ESTIMATE_PREPARATION],
  [STAGE.JOB_IN_PROGRESS]: [STAGE.APPROVED_AWAITING_SCHEDULING],
  [STAGE.INSPECTION_AND_COMPLETION]: [STAGE.JOB_IN_PROGRESS],
  [STAGE.AWAITING_PAYMENT]: [STAGE.JOB_IN_PROGRESS],
  [STAGE.CLOSED]: [STAGE.AWAITING_PAYMENT],
  [STAGE.CANCELED]: [STAGE.NEW_LEAD, STAGE.ESTIMATE_PREPARATION, STAGE.APPROVED_AWAITING_SCHEDULING],
};

export function canMove(from: StageCode, to: StageCode): boolean {
  if (from === to) return true;
  if (to === STAGE.CANCELED) return from !== STAGE.CLOSED;
  if (from === STAGE.CANCELED) return (BACKWARD[from] ?? []).includes(to);
  if (to > from) return true;
  return (BACKWARD[from] ?? []).includes(to);
}

/**
 * Whether an event about an earlier moment should be ignored because a later
 * fact already moved past it. A late webhook must never drag a job back.
 */
export function isStale(event: { occurredAt: string }, latestOccurredAt: string | null | undefined): boolean {
  if (!latestOccurredAt) return false;
  return Date.parse(event.occurredAt) < Date.parse(latestOccurredAt);
}

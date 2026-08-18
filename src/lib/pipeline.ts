/**
 * Where a job sits in the business, derived rather than stored.
 *
 * Every job already carries a status and an evaluation status, and its
 * proposal carries another. A stored pipeline column would be a fourth thing
 * to keep in sync, and the first time someone changed a job's status without
 * touching it the board would start lying. So the stage is read off what's
 * already true.
 *
 * Three stages, in the order work actually moves:
 *   Evaluation — going out to look at it
 *   Sales      — pricing it and getting a yes
 *   Operations — doing the work
 */

export type PipelineStage = "evaluation" | "sales" | "operations";

export const STAGES: { key: PipelineStage; label: string; blurb: string }[] = [
  { key: "evaluation", label: "Evaluation", blurb: "Booked to go look at it." },
  { key: "sales", label: "Sales", blurb: "Priced, quoted, waiting on a yes." },
  { key: "operations", label: "Operations", blurb: "Sold — scheduling and doing the work." },
];

/** The statuses a job can hold within each stage, in order of progress. */
export const STAGE_STATUSES: Record<PipelineStage, string[]> = {
  evaluation: ["Scheduled", "On the way", "Arrived", "Evaluated"],
  sales: ["Needs pricing", "Needs approval", "Sent", "Declined"],
  operations: ["Won — not scheduled", "Scheduled", "In progress", "Needs sign-off", "Completed"],
};

export interface PipelineInput {
  /** jobs.status */
  status: string;
  /** jobs.evaluation_status */
  evaluationStatus: string | null;
  evaluationDate: string | null;
  projectStartDate: string | null;
  projectEndDate: string | null;
  /** job_proposals.status, or null when no proposal exists yet. */
  proposalStatus: string | null;
}

export interface PipelinePosition {
  stage: PipelineStage;
  status: string;
  /** Needs somebody to do something, as opposed to waiting on the client. */
  actionable: boolean;
}

const EVALUATION_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  on_way: "On the way",
  arrived: "Arrived",
  completed: "Evaluated",
};

/**
 * Cancelled jobs are off the board entirely — they aren't a stage, they're an
 * absence of one, and leaving them in a column makes the board a to-do list
 * nobody trusts.
 */
export function isOnPipeline(input: PipelineInput): boolean {
  return input.status !== "cancelled";
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Where a job sits.
 *
 * `today` is a parameter so the "work is over but nobody signed it off" case
 * is testable without mocking the clock.
 */
export function pipelinePosition(input: PipelineInput, today: Date = new Date()): PipelinePosition {
  // Operations first: once it's sold, nothing earlier matters.
  if (input.status === "completed") {
    return { stage: "operations", status: "Completed", actionable: false };
  }
  // Work whose window has passed but that nobody has signed off. This is the
  // one that disappears in practice: the crew finished, drove away, and the
  // job sits "in progress" forever because closing it was never anybody's
  // next task. Surfacing it here is what makes it somebody's.
  const overran =
    input.projectEndDate != null && input.projectEndDate < dateKey(today);

  if (input.status === "in_progress") {
    return overran
      ? { stage: "operations", status: "Needs sign-off", actionable: true }
      : { stage: "operations", status: "In progress", actionable: true };
  }
  if (input.status === "approved" || input.proposalStatus === "accepted") {
    const scheduled = Boolean(input.projectStartDate || input.projectEndDate);
    if (scheduled && overran) {
      return { stage: "operations", status: "Needs sign-off", actionable: true };
    }
    return {
      stage: "operations",
      status: scheduled ? "Scheduled" : "Won — not scheduled",
      // An unscheduled won job is the one that quietly rots, so it's the
      // actionable one here.
      actionable: !scheduled,
    };
  }

  // Evaluation: booked to look at it, and that hasn't finished yet.
  const evaluationDone = input.evaluationStatus === "completed";
  if (input.evaluationDate && !evaluationDone) {
    return {
      stage: "evaluation",
      status: EVALUATION_LABELS[input.evaluationStatus ?? "scheduled"] ?? "Scheduled",
      actionable: true,
    };
  }

  // Everything else is a sale in progress.
  if (input.proposalStatus === "declined") {
    return { stage: "sales", status: "Declined", actionable: false };
  }
  if (input.proposalStatus === "sent") {
    // Waiting on the client, not on us.
    return { stage: "sales", status: "Sent", actionable: false };
  }
  if (input.proposalStatus === "needs_approval") {
    return { stage: "sales", status: "Needs approval", actionable: true };
  }
  return { stage: "sales", status: "Needs pricing", actionable: true };
}

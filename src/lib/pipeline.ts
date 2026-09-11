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

import { inDispute, kindLabel, type DisputeState } from "@/lib/dispute";

export type PipelineStage = "evaluation" | "sales" | "operations" | "disputes";

export const STAGES: { key: PipelineStage; label: string; blurb: string }[] = [
  { key: "evaluation", label: "Evaluation", blurb: "Booked to go look at it." },
  { key: "sales", label: "Sales", blurb: "Priced, quoted, waiting on a yes." },
  { key: "operations", label: "Operations", blurb: "Sold — scheduling and doing the work." },
  // Last on the board on purpose: it should be the column somebody's eye
  // lands on when it is not empty, and invisible when it is.
  {
    key: "disputes",
    label: "Disputes",
    blurb: "Stopped until somebody sorts it out. Nothing automatic goes to these clients.",
  },
];

/** The statuses a job can hold within each stage, in order of progress. */
export const STAGE_STATUSES: Record<PipelineStage, string[]> = {
  evaluation: ["Scheduled", "On the way", "Arrived", "Evaluated"],
  sales: ["Needs pricing", "Needs approval", "Sent", "Declined"],
  operations: ["Won — not scheduled", "Scheduled", "In progress", "Needs sign-off", "Completed"],
  // The kind of trouble rather than a ladder of progress: a dispute does not
  // advance, it is either open or it is over, and what it is decides who
  // deals with it.
  disputes: ["Legal", "Payment", "Quality", "Other"],
};

/**
 * A job placed on the board by hand.
 *
 * Carries the derived answer it was overriding, not just the destination.
 * That is the whole design: an override is a statement about a particular
 * situation ("the proposal says sent, but they said yes on the phone"), and
 * the moment the underlying facts move the situation is gone. Storing a bare
 * stage would be storing the thing this module exists to avoid — a fourth
 * fact that starts lying the first time somebody changes a status.
 */
export interface PipelineOverride {
  stage: PipelineStage;
  status: string;
  /** What the pipeline said when somebody moved it. */
  from: string;
}

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
  /**
   * When somebody decided this job was not happening.
   *
   * A fact rather than a hand placement, and read before nearly everything
   * else because of what went wrong when it was not. A decline stored as an
   * override expired the moment any status moved: the board quietly went back
   * to reading the raw row, and a job the office had said no to reappeared as
   * a live quote for somebody to chase. "They said no" does not stop being
   * true when the visit is rescheduled.
   */
  declinedAt?: string | null;
  /** Set while this job is in dispute. Beats every other reading of the job:
   * a client who is suing us is not a job to get on with, whatever its
   * paperwork says. */
  dispute?: DisputeState | null;
  /** Where somebody put it by hand, if they did. */
  override?: PipelineOverride | null;
}

export interface PipelinePosition {
  stage: PipelineStage;
  status: string;
  /** Needs somebody to do something, as opposed to waiting on the client. */
  actionable: boolean;
  /** Placed by hand rather than read off the job. Shown on the card, because
   * a card sitting somewhere the data does not imply should say so. */
  overridden?: boolean;
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
  // Before anything else, and before a hand placement too. Somebody who moved
  // this job to "In progress" last week did not know about the solicitor's
  // letter that arrived on Monday.
  const dispute = input.dispute ?? null;
  if (dispute && inDispute(dispute)) {
    return {
      stage: "disputes",
      status: kindLabel(dispute.kind),
      // Frozen rather than actionable: it is somebody's problem, but it is
      // not work to pick up off a queue, and it must not pad the counts the
      // board uses to say what needs doing today.
      actionable: false,
    };
  }

  const derived = derivedPosition(input, today);

  // A hand placement wins, right up until the facts it was made against
  // change. Then it is a note about a situation that has passed, and the job
  // goes back to being read off what is true now.
  const override = input.override;
  if (override && override.from === derived.status && isKnownStatus(override)) {
    return {
      stage: override.stage,
      status: override.status,
      // Somebody put it here on purpose, so it is theirs to move on.
      actionable: true,
      overridden: true,
    };
  }

  return derived;
}

/** Whether a stored override still names a place on the board. A stage or a
 * status renamed in a later version must not strand a job nowhere. */
function isKnownStatus(override: PipelineOverride): boolean {
  return (STAGE_STATUSES[override.stage] ?? []).includes(override.status);
}

/**
 * Whether a hand placement still applies.
 *
 * Exported so the job page can say "this was moved by hand and the paperwork
 * has since caught up" rather than silently dropping it.
 */
export function overrideIsStale(input: PipelineInput, today: Date = new Date()): boolean {
  if (!input.override) return false;
  return derivedPosition(input, today).status !== input.override.from;
}

/** Where the job sits on the facts alone, ignoring anything typed on top. */
export function derivedPosition(input: PipelineInput, today: Date = new Date()): PipelinePosition {
  // Operations first: once it's sold, nothing earlier matters.
  if (input.status === "completed") {
    return { stage: "operations", status: "Completed", actionable: false };
  }
  // Then a decline, before any of the derivation below. It outranks a sent
  // proposal, a booked visit and an approved status alike, because all three
  // describe where the paperwork got to and none of them describes somebody
  // saying no. Work that was declined and then genuinely sold is un-declined
  // by moving it back on the board, which clears the date.
  if (input.declinedAt) {
    return { stage: "sales", status: "Declined", actionable: false };
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


/**
 * Whether anybody should still be chasing this job.
 *
 * The one question every other screen needs to ask the pipeline and, until
 * now, could not. The board honoured a hand placement; nothing else did. So a
 * job moved to Declined went on appearing on the dashboard as "out for a
 * decision", on My Day as somebody to ring, and on the calendar as a visit
 * still to drive to, because each of those re-derived from the raw statuses
 * and never looked at the placement. The office had said no twice and the app
 * kept asking.
 *
 * Three things close a job. Declined is somebody deciding it is over, whether
 * the client clicked the button or said it on the phone. Completed is over by
 * definition. And a dispute is frozen rather than finished: it is somebody's
 * problem, but it is not work to pick up off a queue, and nothing automatic
 * should go near that client.
 */
export function isClosedWork(position: PipelinePosition): boolean {
  if (position.stage === "disputes") return true;
  if (position.stage === "sales" && position.status === "Declined") return true;
  if (position.stage === "operations" && position.status === "Completed") return true;
  return false;
}

/**
 * Declined, however it was declined.
 *
 * Kept apart from closed because the two want different treatment: finished
 * work is a record worth showing, and a job somebody said no to is a row that
 * should stop appearing in anybody's queue but still be countable.
 */
export function isDeclined(position: PipelinePosition): boolean {
  return position.stage === "sales" && position.status === "Declined";
}

/** Every place a job can be put by hand, as one flat list for a picker. */
export function movableTo(): { stage: PipelineStage; status: string; label: string }[] {
  const out: { stage: PipelineStage; status: string; label: string }[] = [];
  for (const stage of STAGES) {
    for (const status of STAGE_STATUSES[stage.key]) {
      out.push({ stage: stage.key, status, label: `${stage.label} — ${status}` });
    }
  }
  return out;
}

/** What the card says under a job somebody moved. */
export function overrideNote(position: PipelinePosition): string | null {
  return position.overridden ? "Moved here by hand" : null;
}

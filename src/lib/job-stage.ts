/**
 * What a job can actually do right now.
 *
 * The job page used to show every panel at once, so a brand-new job with no
 * evaluation booked still offered to take an "after" photo and sign the work
 * off. That is not a small annoyance: a form that accepts input it has no
 * business accepting is how records end up describing work that never
 * happened in an order it never happened in.
 *
 * Stage is derived from what already exists rather than stored, for the same
 * reason the pipeline is: a stored stage column becomes a fourth thing to keep
 * in sync and starts lying the first time somebody changes a status without
 * touching it.
 */

import type { JobStatus, WorkSessionStatus } from "@/types/domain";

export type JobStage = "evaluation" | "pricing" | "scheduled" | "working" | "done" | "cancelled";

export const STAGE_LABELS: Record<JobStage, string> = {
  evaluation: "Evaluation",
  pricing: "Pricing & proposal",
  scheduled: "Booked in",
  working: "Work underway",
  done: "Finished",
  cancelled: "Cancelled",
};

/** Short forms for the progress strip. Five full labels do not fit across a
 * phone, and a strip that pushes the stage you are actually in off the edge
 * is worse than no strip at all. */
export const STAGE_SHORT_LABELS: Record<JobStage, string> = {
  evaluation: "Eval",
  pricing: "Price",
  scheduled: "Booked",
  working: "Working",
  done: "Done",
  cancelled: "Cancelled",
};

export const STAGE_BLURBS: Record<JobStage, string> = {
  evaluation: "Go look at it, measure it, and take your before photos.",
  pricing: "Price the zones and get the proposal in front of them.",
  scheduled: "Sold. Book the visits and get on site.",
  working: "On site — document as you go, then sign it off.",
  done: "Signed off. Invoice it, or raise a ticket if you have to go back.",
  cancelled: "This job is cancelled. Reopen it to do anything else.",
};

/** Everything the job page can offer. Each one is gated separately because
 * they genuinely unlock at different moments. */
export type Capability =
  | "measure"
  | "scheduleEstimate"
  | "proposal"
  | "visits"
  | "photoBefore"
  | "photoDuring"
  | "photoAfter"
  | "signOff"
  | "invoice"
  | "tickets";

export interface StageInput {
  status: JobStatus;
  evaluationStatus: string;
  evaluationDate: string | null;
  proposalStatus: string | null;
  sessions: { status: WorkSessionStatus }[];
}

/** Whether any visit has actually begun. Booking a visit is not the same as
 * turning up to it, and "during" photos only make sense once somebody has. */
export function workHasStarted(input: StageInput): boolean {
  if (input.status === "in_progress" || input.status === "completed") return true;
  return input.sessions.some((s) => s.status === "in_progress" || s.status === "paused" || s.status === "done");
}

export function deriveStage(input: StageInput): JobStage {
  if (input.status === "cancelled") return "cancelled";
  if (input.status === "completed") return "done";
  if (workHasStarted(input)) return "working";

  const sold = input.status === "approved" || input.proposalStatus === "accepted";
  if (sold) return "scheduled";

  // The evaluation is finished when the visit is, which is what lets pricing
  // begin. A job with no visit booked at all is still at the start.
  if (input.evaluationStatus === "completed") return "pricing";
  return "evaluation";
}

export type Availability = { available: true } | { available: false; reason: string };

const OK: Availability = { available: true };

/**
 * What is open right now, and what each locked thing is waiting for.
 *
 * The reason matters as much as the lock. "Not available" teaches nobody
 * anything; "finish the evaluation first" tells somebody what to go and do.
 */
export function capabilities(input: StageInput): Record<Capability, Availability> {
  const stage = deriveStage(input);
  const started = workHasStarted(input);
  const evaluated = input.evaluationStatus === "completed";
  const sold = input.status === "approved" || input.proposalStatus === "accepted" || started;

  if (stage === "cancelled") {
    const locked: Availability = { available: false, reason: "This job is cancelled. Reopen it first." };
    return {
      measure: locked,
      scheduleEstimate: locked,
      proposal: locked,
      visits: locked,
      photoBefore: locked,
      photoDuring: locked,
      photoAfter: locked,
      signOff: locked,
      invoice: locked,
      // A cancelled job can still carry the record of why somebody went back.
      tickets: started ? OK : locked,
    };
  }

  return {
    // Measuring is the evaluation. It stays open afterwards because scope
    // changes and the drawing is the source of the price.
    measure: OK,

    scheduleEstimate: evaluated
      ? { available: false, reason: "The evaluation is done — no visit left to book." }
      : OK,

    // The gate that matters: you cannot price what nobody has been to look at.
    proposal: evaluated
      ? OK
      : { available: false, reason: "Finish the evaluation first — there's nothing measured to price." },

    visits: sold
      ? OK
      : evaluated
        ? { available: false, reason: "Get the proposal accepted before booking the crew." }
        : { available: false, reason: "Finish the evaluation and get the proposal accepted first." },

    // Before shots are taken on the evaluation visit, so they open as soon as
    // there is a visit to take them on.
    photoBefore: input.evaluationDate
      ? OK
      : { available: false, reason: "Book the evaluation first — before photos get taken on that visit." },

    photoDuring: started
      ? OK
      : { available: false, reason: "Start a visit first — there's no work in progress to photograph." },

    photoAfter: started
      ? OK
      : { available: false, reason: "Start a visit first — there's no finished work to photograph." },

    signOff: started
      ? OK
      : { available: false, reason: "Start a visit first. Work can't be signed off before it's been done." },

    // Invoicing before the work is done is how a business gets a reputation.
    invoice: stage === "done" || started
      ? OK
      : { available: false, reason: "Invoice once the work has actually started." },

    tickets: started
      ? OK
      : { available: false, reason: "Nothing to go back for yet — no work has been done." },
  };
}

/** The one thing most worth doing next, for the header. */
export function nextStep(input: StageInput): string {
  const stage = deriveStage(input);
  switch (stage) {
    case "cancelled":
      return "Reopen the job to carry on.";
    case "evaluation":
      return input.evaluationDate
        ? "Go and evaluate it, then mark the visit complete."
        : "Book the evaluation visit.";
    case "pricing":
      return input.proposalStatus === "sent"
        ? "Waiting on the client to accept the proposal."
        : "Price the zones and send the proposal.";
    case "scheduled":
      return "Book the crew's visits.";
    case "working":
      return "Document each zone, then sign the job off.";
    case "done":
      return "Invoice it, or raise a ticket if you have to go back.";
  }
}

/**
 * Where each evaluation out today has got to, for the account manager: one
 * bar, seven steps, from what the evaluator and the client already did. The
 * client's pre-eval, on the way, at the house, the walkthrough with the areas
 * reviewed, submitted, then the account manager's own two: priced, and sent.
 *
 * Pure, so where a visit is shown to be is tested without a database.
 */

export const EVALUATION_STEPS = ["Pre-eval", "On the way", "Arrived", "Walkthrough", "Submitted", "Priced", "Sent"] as const;

export interface EvaluationInput {
  /** When the visit is booked for. */
  dueAt: string;
  /** The client sent their pre-eval. */
  preEval: boolean;
  onWayAt: string | null;
  arrivedAt: string | null;
  submittedAt: string | null;
  /** The account manager has priced it: the proposal is past needing approval. */
  pricedAt: string | null;
  /** The proposal went to the client. */
  sentAt: string | null;
  /** The areas on the walkthrough, and how many have been reviewed. */
  areasReviewed: number;
  areasTotal: number;
}

export interface EvaluationStage {
  /** The step under way or next; every step before it is done (the pre-eval aside). */
  step: number;
  /** Whether that step is under way, rather than waiting to begin. */
  moving: boolean;
  now: string;
  since: string | null;
  late: boolean;
  /** Waiting on the account manager: to price, or to send. */
  yourMove: "price" | "send" | null;
  issues: string[];
}

/** How each step shows on the bar. The pre-eval is its own: done, or missing. */
export function evaluationStepState(i: number, stage: EvaluationStage, preEval: boolean): "done" | "now" | "todo" | "missing" {
  if (i === 0) return preEval ? "done" : "missing";
  if (i < stage.step) return "done";
  return i === stage.step && stage.moving ? "now" : "todo";
}

const time = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone }).toLowerCase();

export function evaluationStage(input: EvaluationInput, now: Date, timeZone = "America/New_York"): EvaluationStage {
  const issues: string[] = [];
  const due = new Date(input.dueAt).getTime();
  const late = !input.arrivedAt && !input.submittedAt && now.getTime() > due;
  if (late) {
    issues.push(input.onWayAt ? `Running late: due at ${time(input.dueAt, timeZone)}, still on the way` : `Late: due at ${time(input.dueAt, timeZone)} and not on the way`);
  }
  if (!input.preEval && !input.submittedAt) issues.push("No pre-eval from the client. It'll be done with them on site.");
  const base = { late, issues };

  if (input.sentAt) return { ...base, step: EVALUATION_STEPS.length, moving: false, now: "Sent to the client", since: input.sentAt, yourMove: null };
  if (input.pricedAt) return { ...base, step: 6, moving: true, now: "Priced. Ready for you to send", since: input.pricedAt, yourMove: "send" };
  if (input.submittedAt) return { ...base, step: 5, moving: true, now: "Submitted. Waiting on you to price it", since: input.submittedAt, yourMove: "price" };
  if (input.arrivedAt) return { ...base, step: 3, moving: true, now: "Walking it with the client", since: input.arrivedAt, yourMove: null };
  if (input.onWayAt) return { ...base, step: 1, moving: true, now: "On the way", since: input.onWayAt, yourMove: null };
  return { ...base, step: 1, moving: false, now: "Not on the way yet", since: null, yourMove: null };
}

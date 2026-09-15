/**
 * Evaluations, from the selling side.
 *
 * The calendar answers "when is it"; this answers "what does it still owe
 * us". An evaluation that happened and produced no proposal is the most
 * expensive thing in the business -- somebody drove to a house, measured it,
 * and then nothing -- and it was visible nowhere.
 */

export type EvaluationBucket = "overdue" | "booked" | "awaiting-proposal";

export const EVALUATION_BUCKETS: readonly EvaluationBucket[] = ["awaiting-proposal", "overdue", "booked"];

export const BUCKET_LABEL: Record<EvaluationBucket, string> = {
  "awaiting-proposal": "Done, no proposal yet",
  overdue: "Past and not written up",
  booked: "Coming up",
};

export interface SalesEvaluation {
  jobId: string;
  jobNumber: number | null;
  customerName: string | null;
  address: string | null;
  /** When the appointment is, or was. */
  at: string | null;
  /** The evaluator's progress: scheduled, on_way, arrived, completed, cancelled. */
  evaluationStatus: string;
  /** The job's own status: estimating, quoted, approved... */
  status: string;
  assignedToName: string | null;
}

/**
 * Where an evaluation sits, or null when it is not a live one.
 *
 * A job that has been quoted or sold has already produced its proposal, so it
 * leaves this screen -- it is the pipeline's now. Cancelled ones leave too.
 */
export function bucketOf(evaluation: SalesEvaluation, now: string): EvaluationBucket | null {
  if (evaluation.evaluationStatus === "cancelled" || evaluation.status === "cancelled") return null;
  // Past the sale: the proposal exists, so the evaluation is not owed.
  if (evaluation.status !== "estimating") return null;
  if (evaluation.evaluationStatus === "completed") return "awaiting-proposal";
  if (!evaluation.at) return "booked";
  return evaluation.at < now ? "overdue" : "booked";
}

export function inBucket(
  evaluations: readonly SalesEvaluation[],
  bucket: EvaluationBucket,
  now: string
): SalesEvaluation[] {
  const rows = evaluations.filter((e) => bucketOf(e, now) === bucket);
  // Oldest first everywhere: the one that has been waiting longest is the one
  // to deal with, whether it is unwritten or unattended.
  return rows.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}

/** How many are in each bucket, for the headings. */
export function bucketCounts(
  evaluations: readonly SalesEvaluation[],
  now: string
): Record<EvaluationBucket, number> {
  const counts: Record<EvaluationBucket, number> = { overdue: 0, booked: 0, "awaiting-proposal": 0 };
  for (const evaluation of evaluations) {
    const bucket = bucketOf(evaluation, now);
    if (bucket) counts[bucket] += 1;
  }
  return counts;
}

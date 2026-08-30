/**
 * What a payment does to the job it paid for.
 *
 * Recording the money is not the same as moving the work. The board reads a
 * job's position off its own status and its proposal's, and neither of those
 * knows anything about a payment — so importing a year of receipts recorded
 * when every client paid and left their cards sitting in Sales, quoted and
 * apparently still waiting on a yes.
 *
 * Money is the least ambiguous signal there is. Somebody who has paid has
 * bought the work, whatever the paperwork in front of it says.
 *
 * What is deliberately not done: the client's own answer is left alone. A
 * proposal says "sent" because that is what the client did with it, and
 * writing "accepted" onto it would be inventing a click that never happened.
 * The job is marked sold instead, which is the thing the payment actually
 * proves, and the board reads that just as well.
 */

/** Statuses a payment must not overwrite, and why each one matters. */
const LEAVE_ALONE = new Set([
  // Already further along than "sold". Moving these back would be a step
  // backwards on the board for a job that has been done.
  "completed",
  "in_progress",
  // Somebody stopped this on purpose. A late payment or a refund landing
  // against it is a conversation, not a reason to quietly restart the work.
  "cancelled",
  // Already there.
  "approved",
]);

/**
 * The status this job should hold now the money is in, or null to leave it.
 *
 * Null is the common answer on a healthy job and the right one whenever there
 * is any doubt: an import that moves nothing is recoverable, and one that
 * reopens a cancelled job is somebody driving to an address they should not.
 */
export function stageAfterPayment(jobStatus: string): string | null {
  if (LEAVE_ALONE.has(jobStatus)) return null;
  return "approved";
}

/** Which of these jobs a payment import should actually move. */
export function jobsToMarkSold(
  jobs: { jobId: string; status: string }[]
): string[] {
  return jobs.filter((job) => stageAfterPayment(job.status) !== null).map((job) => job.jobId);
}

/** What the import says about it afterwards. */
export function soldLine(count: number): string | null {
  if (count === 0) return null;
  return count === 1
    ? "1 job moved to Operations, because it has been paid for"
    : `${count} jobs moved to Operations, because they have been paid for`;
}

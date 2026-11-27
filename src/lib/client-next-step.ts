import { sameAddress } from "@/lib/address-normalize";
import type { FileJob } from "@/lib/data/client-file";

/**
 * The one thing to do next on a job, so a client's page reads as a single
 * clear step rather than every button at once. Pure, so it is tested.
 */
export type NextStep =
  | { kind: "price"; label: string }
  | { kind: "visit"; label: string }
  | { kind: "send_estimate"; label: string }
  | { kind: "approve_proposal"; label: string }
  | { kind: "send_proposal"; label: string }
  | { kind: "await_answer"; label: string }
  | { kind: "schedule"; label: string }
  | { kind: "none"; label: string };

export function nextStep(job: FileJob, now: Date = new Date()): NextStep {
  const p = job.proposal;
  const est = job.estimate;
  if (job.status === "cancelled") return { kind: "none", label: "Cancelled" };
  if (job.status === "completed") return { kind: "none", label: "Finished" };
  if (p?.status === "accepted") return job.startDate ? { kind: "none", label: "Sold and on the schedule" } : { kind: "schedule", label: "Sold: put it on the schedule" };
  if (p?.status === "declined") return { kind: "none", label: "They said no to the proposal" };
  if (p?.status === "needs_approval") return { kind: "approve_proposal", label: "Approve the proposal, then send it" };
  if (p?.status === "sent" && !p.sentAt) return { kind: "send_proposal", label: "Send the proposal" };
  if (p?.status === "sent") return { kind: "await_answer", label: "Proposal sent: waiting on their answer" };
  if (est?.paidAt) return { kind: "none", label: est.choice === "evaluation" ? "Paid for a visit" : "Deposit paid" };
  if (est?.total != null) return { kind: "send_estimate", label: "Estimate done: send it to them" };
  if (job.evaluationDate && new Date(job.evaluationDate).getTime() > now.getTime()) return { kind: "visit", label: "Visit booked" };
  if (job.evaluationDate) return { kind: "price", label: "Visit done: price it on the map" };
  return { kind: "price", label: "Price it on the map" };
}

/** Nothing on it yet: no price, proposal, invoice, message or visit. */
function isEmpty(job: FileJob): boolean {
  return (
    job.status === "estimating" &&
    !job.proposal &&
    job.estimate?.total == null &&
    !job.estimate?.paidAt &&
    job.invoices.length === 0 &&
    job.messages.length === 0 &&
    !job.evaluationDate
  );
}

/**
 * The client's jobs with empty copies left out. Pressing New estimate more
 * than once at the same house used to leave several empty "Estimate" jobs
 * beside the real one, so a client showed four or five times. An empty job
 * is hidden when another job at the same address is still open; of several
 * empty ones and nothing else, only the newest stays. `keepId` (the job the
 * page was opened on) is never hidden.
 */
export function withoutEmptyCopies(jobs: FileJob[], keepId?: string): FileJob[] {
  const live = (j: FileJob) => j.status !== "cancelled" && j.status !== "completed";
  return jobs.filter((j, i) => {
    if (j.id === keepId || !isEmpty(j)) return true;
    const same = jobs.filter((o, k) => k !== i && live(o) && sameAddress(o.address, j.address));
    if (same.some((o) => !isEmpty(o) || o.id === keepId)) return false;
    // All empty: jobs come newest first, so keep the first of them.
    return !same.some((o) => jobs.indexOf(o) < i);
  });
}

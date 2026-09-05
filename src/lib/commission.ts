/**
 * What an account manager has earned.
 *
 * The rule the business actually runs on: an account manager takes a
 * percentage of the money **collected** on the projects they manage, and it
 * becomes payable once the job is finished and there is nothing outstanding
 * on it.
 *
 * Two parts of that are easy to get wrong and are deliberate here.
 *
 * It is a share of what came in, not of what was quoted. A proposal is a
 * hope; an invoice is a claim; only a payment is money. Paying commission on
 * an invoice that never clears means paying out on revenue the business never
 * saw, and clawing it back afterwards is a conversation nobody wins.
 *
 * And "no issues" is a real gate, not a formality. A job with an open ticket
 * is a job somebody still has to go back to, and the cost of that trip has
 * not landed yet. The commission is not cancelled by it — it is held, in
 * plain sight, with the reason attached.
 */

import type { JobStatus } from "@/types/domain";

/** What the business pays an account manager when nothing else is set on
 * their profile. Overridable per person on the Team page. */
export const DEFAULT_ACCOUNT_MANAGER_PCT = 15;

export type CommissionState = "earned" | "held" | "accruing";

export const STATE_LABELS: Record<CommissionState, string> = {
  earned: "Payable",
  held: "Held",
  accruing: "Accruing",
};

export interface CommissionJobInput {
  jobId: string;
  customerName: string;
  address: string;
  status: JobStatus;
  completedAt: string | null;
  /** Money actually received against this job — paid invoices plus cash and
   * cheques recorded on the ledger. */
  collected: number;
  /** What the job is worth in total, for showing how much is still to come. */
  contractValue: number | null;
  /** Tickets still open or scheduled. Resolved and closed ones do not hold a
   * payout — they are the record of something already dealt with. */
  openTickets: number;
}

export interface CommissionLine {
  jobId: string;
  customerName: string;
  address: string;
  state: CommissionState;
  /** Why it is not payable yet. Empty when it is. */
  reason: string;
  collected: number;
  contractValue: number | null;
  /** Still to collect before the commission stops growing. */
  outstanding: number;
  pct: number;
  amount: number;
  completedAt: string | null;
  openTickets: number;
}

export interface CommissionSummary {
  pct: number;
  lines: CommissionLine[];
  /** Finished, clean, and payable now. */
  earned: number;
  /** Finished but with something open on it. */
  held: number;
  /** Money already in on jobs still running. */
  accruing: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Whether this one is payable, and if not, what is in the way.
 *
 * Cancelled jobs are not a state here — they are handled by leaving them out
 * of the list entirely, because a cancelled job has no commission to be in
 * any state about.
 */
export function commissionState(job: CommissionJobInput): {
  state: CommissionState;
  reason: string;
} {
  if (job.status !== "completed") {
    return { state: "accruing", reason: "Job isn't finished yet." };
  }
  if (job.openTickets > 0) {
    return {
      state: "held",
      reason:
        job.openTickets === 1
          ? "One ticket still open on this job."
          : `${job.openTickets} tickets still open on this job.`,
    };
  }
  if (job.collected <= 0) {
    return {
      state: "held",
      reason: "Finished, but nothing has been collected yet.",
    };
  }
  return { state: "earned", reason: "" };
}

/**
 * One account manager's book.
 *
 * Cancelled jobs are dropped. Everything else appears, including jobs with
 * nothing collected yet — a line reading $0 with "nothing collected" against
 * it is the one worth chasing, and hiding it would hide the chase.
 */
export function commissionFor(
  jobs: CommissionJobInput[],
  pct: number | null,
): CommissionSummary {
  const rate = pct ?? DEFAULT_ACCOUNT_MANAGER_PCT;

  const lines = jobs
    .filter((job) => job.status !== "cancelled")
    .map((job): CommissionLine => {
      const { state, reason } = commissionState(job);
      return {
        jobId: job.jobId,
        customerName: job.customerName,
        address: job.address,
        state,
        reason,
        collected: round2(job.collected),
        contractValue: job.contractValue,
        outstanding: round2(
          Math.max(0, (job.contractValue ?? job.collected) - job.collected),
        ),
        pct: rate,
        amount: round2((rate / 100) * job.collected),
        completedAt: job.completedAt,
        openTickets: job.openTickets,
      };
    })
    // Payable first — that is the number somebody opened this to find. Then
    // held, because those are the ones to go and unblock.
    .sort((a, b) => {
      const order: Record<CommissionState, number> = {
        earned: 0,
        held: 1,
        accruing: 2,
      };
      if (order[a.state] !== order[b.state])
        return order[a.state] - order[b.state];
      return b.amount - a.amount;
    });

  const sum = (state: CommissionState) =>
    round2(
      lines
        .filter((l) => l.state === state)
        .reduce((total, l) => total + l.amount, 0),
    );

  return {
    pct: rate,
    lines,
    earned: sum("earned"),
    held: sum("held"),
    accruing: sum("accruing"),
  };
}

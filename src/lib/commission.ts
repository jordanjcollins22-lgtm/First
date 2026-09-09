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

export type CommissionState = "paid" | "earned" | "held" | "accruing";

export const STATE_LABELS: Record<CommissionState, string> = {
  paid: "Paid",
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
  /**
   * What has already been handed over on this job, and when.
   *
   * Commission on a job keeps growing while money keeps coming in, so a job
   * can be part paid: eight hundred collected and paid out on, then another
   * four hundred arrives. What is owed is what the rate says minus what has
   * gone, which is why this is an amount and not a flag.
   */
  paidOut?: number;
  lastPaidAt?: string | null;
}

export interface CommissionLine {
  jobId: string;
  customerName: string;
  address: string;
  state: CommissionState;
  /** Why it is not payable yet. Empty when it is. */
  reason: string;
  /** What the rate says this job has earned in total. */
  earnedTotal: number;
  /** What has already been handed over against it. */
  paidOut: number;
  lastPaidAt: string | null;
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
  /** Finished, clean, and payable now, less anything already handed over. */
  earned: number;
  /** Finished but with something open on it. */
  held: number;
  /** Money already in on jobs still running. */
  accruing: number;
  /** Already handed over. The answer to "have I been paid for that one". */
  paid: number;
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
 *
 * Paid comes first, and deliberately not last. A job whose commission has
 * already been handed over is settled whatever else is true of it, and the
 * question somebody opens this to answer is "have I been paid for that one".
 * A job can leave that state again: commission grows with what is collected,
 * so another cheque on a paid job puts it back to payable for the difference.
 */
export function commissionState(
  job: CommissionJobInput,
  rate: number
): { state: CommissionState; reason: string } {
  const earnedTotal = round2((rate / 100) * job.collected);
  const paidOut = round2(job.paidOut ?? 0);
  // A cent of rounding is not a debt.
  const owed = round2(earnedTotal - paidOut);

  if (paidOut > 0 && owed <= 0.01) {
    return {
      state: "paid",
      reason: job.lastPaidAt ? `Paid on ${new Date(job.lastPaidAt).toLocaleDateString()}.` : "Paid.",
    };
  }
  if (paidOut > 0 && job.status === "completed" && job.openTickets === 0) {
    return { state: "earned", reason: `Part paid. ${money(owed)} still to come.` };
  }
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

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/**
 * One account manager's book.
 *
 * Cancelled jobs are dropped. Everything else appears, including jobs with
 * nothing collected yet — a line reading $0 with "nothing collected" against
 * it is the one worth chasing, and hiding it would hide the chase.
 *
 * Every figure on a line is what is still owed on it rather than what it has
 * ever been worth, so a book that has been paid out reads as zero owed rather
 * than as the same money twice.
 */
export function commissionFor(
  jobs: CommissionJobInput[],
  pct: number | null,
): CommissionSummary {
  const rate = pct ?? DEFAULT_ACCOUNT_MANAGER_PCT;

  const lines = jobs
    .filter((job) => job.status !== "cancelled")
    .map((job): CommissionLine => {
      const { state, reason } = commissionState(job, rate);
      const earnedTotal = round2((rate / 100) * job.collected);
      const paidOut = round2(job.paidOut ?? 0);
      return {
        jobId: job.jobId,
        customerName: job.customerName,
        address: job.address,
        state,
        reason,
        earnedTotal,
        paidOut,
        lastPaidAt: job.lastPaidAt ?? null,
        collected: round2(job.collected),
        contractValue: job.contractValue,
        outstanding: round2(
          Math.max(0, (job.contractValue ?? job.collected) - job.collected),
        ),
        pct: rate,
        // What is still owed on this job. A paid line reads zero, which is
        // the honest answer to "what do I get for that one".
        amount: round2(Math.max(0, earnedTotal - paidOut)),
        completedAt: job.completedAt,
        openTickets: job.openTickets,
      };
    })
    // Payable first — that is the number somebody opened this to find. Then
    // held, because those are the ones to go and unblock. Paid last: it is
    // the answer to a question, not a thing to do.
    .sort((a, b) => {
      const order: Record<CommissionState, number> = {
        earned: 0,
        held: 1,
        accruing: 2,
        paid: 3,
      };
      if (order[a.state] !== order[b.state])
        return order[a.state] - order[b.state];
      if (a.state === "paid") return (b.lastPaidAt ?? "").localeCompare(a.lastPaidAt ?? "");
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
    // Every job's payout, not only the ones that are fully settled: a part
    // paid job has had money handed over and it belongs in this total.
    paid: round2(lines.reduce((total, l) => total + l.paidOut, 0)),
  };
}

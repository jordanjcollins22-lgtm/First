/**
 * The projects a team member brought in, and where each has got to.
 *
 * Anybody on the team can bring work in: a neighbor of the job they are on,
 * more work for the client in front of them, somebody they know. Whatever
 * sells pays them the affiliate's 4%, so the list says what each one is
 * worth to them and what it is waiting on. Pure, so it is tested.
 */

export const BROUGHT_IN_RATE = 0.04;

export interface BroughtInJob {
  jobId: string;
  client: string;
  address: string;
  jobStatus: string;
  evaluationDate: string | null;
  proposalStatus: string | null;
  /** What the client pays, in dollars, once there is a price. */
  price: number | null;
  createdAt: string;
}

export type BroughtInStep = "lead" | "evaluation" | "proposal" | "sold" | "done" | "lost";

export interface BroughtInRow extends BroughtInJob {
  step: BroughtInStep;
  /** What it is waiting on, in a few words. */
  label: string;
  /** Their 4%, in dollars, once there is a price. Null before that. */
  yours: number | null;
}

export function broughtInStep(job: BroughtInJob): BroughtInStep {
  if (job.jobStatus === "cancelled" || job.proposalStatus === "declined") return "lost";
  if (job.jobStatus === "completed") return "done";
  if (job.jobStatus === "approved" || job.jobStatus === "in_progress" || job.proposalStatus === "accepted") return "sold";
  if (job.proposalStatus === "sent" || job.proposalStatus === "needs_approval") return "proposal";
  if (job.evaluationDate) return "evaluation";
  return "lead";
}

const LABEL: Record<BroughtInStep, string> = {
  lead: "New lead: the office is booking the free evaluation",
  evaluation: "Evaluation booked",
  proposal: "Priced, waiting on the client",
  sold: "Sold: you earn 4% when it's paid",
  done: "Done",
  lost: "Didn't go ahead",
};

export function broughtInRows(jobs: BroughtInJob[]): BroughtInRow[] {
  return jobs
    .map((job) => {
      const step = broughtInStep(job);
      const label =
        step === "evaluation" && job.evaluationDate
          ? `Evaluation booked for ${new Date(job.evaluationDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" })}`
          : LABEL[step];
      return { ...job, step, label, yours: job.price != null && job.price > 0 && step !== "lost" ? Math.round(job.price * BROUGHT_IN_RATE * 100) / 100 : null };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The ones still on their way to being done: what "upcoming" counts. */
export function upcoming(rows: BroughtInRow[]): BroughtInRow[] {
  return rows.filter((r) => r.step !== "done" && r.step !== "lost");
}

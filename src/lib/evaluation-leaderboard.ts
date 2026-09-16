/**
 * Who turns evaluations into jobs.
 *
 * An evaluation is a visit; a proposal is what came of it; an accepted
 * proposal is a sale. The person on the visit is judged on the last of
 * those, because that is the one the business is paid for. The rest is how
 * they got there: how many visits, how many turned into a proposal, how
 * fast, and how many of those were accepted. A person with plenty of
 * visits and few proposals is slow to write; plenty of proposals and few
 * accepted is pricing or pitch; few visits is a calendar problem.
 */

export interface EvaluatorJob {
  jobId: string;
  clientName: string;
  address: string | null;
  evaluationStatus: string | null;
  evaluationDate: string | null;
  /** When the proposal went out, if one did. */
  proposalSentAt: string | null;
  proposalStatus: string | null;
  proposalTotal: number | null;
  acceptedAt: string | null;
  /** Money the client has paid on the job. */
  collected: number;
}

export interface EvaluatorInput {
  profileId: string;
  name: string;
  jobs: EvaluatorJob[];
}

export interface EvaluatorStanding {
  profileId: string;
  name: string;
  rank: number;
  /** Visits marked done. */
  evaluations: number;
  cancelled: number;
  /** Still on the calendar. */
  upcoming: number;
  proposals: number;
  closed: number;
  /** Accepted proposals over proposals sent, when there are enough to say. */
  closeRate: number | null;
  /** Accepted total, before discounts are collected. */
  sold: number;
  collected: number;
  /** Mean days from the visit to the proposal going out. */
  daysToProposal: number | null;
  /** Visits done with no proposal yet: the money left on the table. */
  awaitingProposal: number;
  /** Every job in the window, newest visit first, with where it got to. */
  pipeline: EvaluatorJobLine[];
}

export type EvaluatorStage = "booked" | "cancelled" | "visited" | "proposal" | "closed" | "declined";

export const EVALUATOR_STAGE_LABEL: Record<EvaluatorStage, string> = {
  booked: "Booked",
  cancelled: "Cancelled",
  visited: "Visited, no proposal yet",
  proposal: "Proposal out",
  closed: "Closed",
  declined: "Declined",
};

export interface EvaluatorJobLine {
  jobId: string;
  clientName: string;
  address: string | null;
  visitDate: string | null;
  stage: EvaluatorStage;
  proposalTotal: number | null;
  collected: number;
  /** Days from the visit to the proposal, when both happened. */
  daysToProposal: number | null;
}

export function stageOf(job: EvaluatorJob): EvaluatorStage {
  if (isAccepted(job.proposalStatus)) return "closed";
  if (job.proposalStatus === "declined") return "declined";
  if (job.proposalSentAt) return "proposal";
  if (job.evaluationStatus === "cancelled") return "cancelled";
  if (job.evaluationStatus === "completed") return "visited";
  return "booked";
}

const DAY = 86_400_000;

export function isAccepted(status: string | null): boolean {
  return status === "accepted";
}

/** Only jobs whose visit falls on or after `since`, when a window is given. */
function inWindow(job: EvaluatorJob, since: Date | null): boolean {
  if (!since) return true;
  if (!job.evaluationDate) return false;
  return new Date(job.evaluationDate).getTime() >= since.getTime();
}

export function rankEvaluators(inputs: EvaluatorInput[], options: { since?: Date | null; now?: Date } = {}): EvaluatorStanding[] {
  const since = options.since ?? null;
  const now = options.now ?? new Date();
  const standings = inputs
    .map((person) => {
      const jobs = person.jobs.filter((j) => inWindow(j, since));
      const done = jobs.filter((j) => j.evaluationStatus === "completed");
      const cancelled = jobs.filter((j) => j.evaluationStatus === "cancelled").length;
      const upcoming = jobs.filter(
        (j) => j.evaluationStatus === "scheduled" && j.evaluationDate && new Date(j.evaluationDate).getTime() >= now.getTime()
      ).length;
      const withProposal = jobs.filter((j) => j.proposalSentAt);
      const closedJobs = jobs.filter((j) => isAccepted(j.proposalStatus));
      const gaps = withProposal
        .filter((j) => j.evaluationDate)
        .map((j) => (new Date(j.proposalSentAt as string).getTime() - new Date(j.evaluationDate as string).getTime()) / DAY)
        .filter((d) => d >= 0);
      const awaitingProposal = done.filter((j) => !j.proposalSentAt).length;
      return {
        profileId: person.profileId,
        name: person.name,
        rank: 0,
        evaluations: done.length,
        cancelled,
        upcoming,
        proposals: withProposal.length,
        closed: closedJobs.length,
        closeRate: withProposal.length >= 3 ? closedJobs.length / withProposal.length : null,
        sold: Math.round(closedJobs.reduce((sum, j) => sum + (j.proposalTotal ?? 0), 0)),
        collected: Math.round(jobs.reduce((sum, j) => sum + j.collected, 0)),
        daysToProposal: gaps.length > 0 ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10 : null,
        awaitingProposal,
        pipeline: [...jobs]
          .sort((a, b) => (b.evaluationDate ?? "").localeCompare(a.evaluationDate ?? ""))
          .map((j) => ({
            jobId: j.jobId,
            clientName: j.clientName,
            address: j.address,
            visitDate: j.evaluationDate,
            stage: stageOf(j),
            proposalTotal: j.proposalTotal,
            collected: j.collected,
            daysToProposal:
              j.proposalSentAt && j.evaluationDate
                ? Math.max(0, Math.round(((new Date(j.proposalSentAt).getTime() - new Date(j.evaluationDate).getTime()) / DAY) * 10) / 10)
                : null,
          })),
      };
    })
    .filter((s) => s.evaluations + s.cancelled + s.upcoming + s.proposals > 0);

  return standings
    .sort(
      (a, b) =>
        b.closed - a.closed || b.sold - a.sold || b.proposals - a.proposals || b.evaluations - a.evaluations || a.name.localeCompare(b.name)
    )
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

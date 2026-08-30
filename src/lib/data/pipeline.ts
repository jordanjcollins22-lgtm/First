import { createClient } from "@/lib/supabase/server";
import { listJobsWithLocation } from "@/lib/data/jobs";
import { isOnPipeline, pipelinePosition, type PipelineOverride, type PipelineStage } from "@/lib/pipeline";
import { NO_VIEWS, viewsForAllProposals } from "@/lib/data/proposal-views";
import { activityLabel, isHot, watchingFor, type ViewSummary } from "@/lib/proposal-views";

export interface PipelineCard {
  jobId: string;
  jobNumber: number | null;
  customerName: string;
  address: string;
  stage: PipelineStage;
  status: string;
  actionable: boolean;
  /** Shown on the card so it's obvious what's driving the position. */
  value: number | null;
  date: string | null;
  assignedTo: string | null;
  /**
   * Whether the client has been reading the quote, on the cards where that
   * is still an open question — sent, unanswered, unpaid.
   *
   * Null everywhere else. A card saying only "proposal sent" is the same card
   * for a week whether they opened it four times this morning or never at
   * all, and those are different jobs to do.
   */
  activity: string | null;
  /** Opened within the hour: somebody who can still be rung while they are
   * on the page. */
  activityHot: boolean;
  /** Placed here by hand rather than read off the job. */
  overridden: boolean;
}

export async function getPipeline(): Promise<PipelineCard[]> {
  const jobs = await listJobsWithLocation();
  if (jobs.length === 0) return [];

  // One query for every proposal rather than one per job.
  const supabase = await createClient();
  const [{ data: proposals }, views] = await Promise.all([
    supabase
      .from("job_proposals")
      .select("id, job_id, status, total_cost, paid_at")
      .in(
        "job_id",
        jobs.map((j) => j.id)
      ),
    // Empty before the views migration, or if it fails: a board without the
    // read counts is the board we had, and it still has to render.
    viewsForAllProposals().catch(() => ({}) as Record<string, ViewSummary>),
  ]);

  const proposalByJob = new Map(
    (
      (proposals ?? []) as {
        id: string;
        job_id: string;
        status: string;
        total_cost: number | null;
        paid_at: string | null;
      }[]
    ).map((p) => [p.job_id, p])
  );

  // Worded here rather than in the page, so the board and the proposals list
  // can never describe the same activity differently.
  const now = new Date();

  return jobs
    .map((job) => {
      const proposal = proposalByJob.get(job.id) ?? null;
      const override: PipelineOverride | null =
        job.pipeline_override_stage && job.pipeline_override_status && job.pipeline_override_from
          ? {
              stage: job.pipeline_override_stage as PipelineStage,
              status: job.pipeline_override_status,
              from: job.pipeline_override_from,
            }
          : null;

      const input = {
        status: job.status,
        evaluationStatus: job.evaluation_status,
        evaluationDate: job.evaluation_date,
        projectStartDate: job.project_start_date,
        projectEndDate: job.project_end_date,
        proposalStatus: proposal?.status ?? null,
        override,
      };
      if (!isOnPipeline(input)) return null;

      const position = pipelinePosition(input);
      const summary = proposal ? (views[proposal.id] ?? NO_VIEWS) : NO_VIEWS;
      const watching = watchingFor(proposal?.status ?? null, proposal?.paid_at ?? null);

      return {
        jobId: job.id,
        jobNumber: job.job_number,
        customerName: job.property.customer.name,
        address: job.property.address,
        stage: position.stage,
        status: position.status,
        actionable: position.actionable,
        value: proposal?.total_cost ?? null,
        date:
          position.stage === "evaluation"
            ? job.evaluation_date
            : (job.project_start_date ?? job.project_end_date),
        assignedTo: job.assigned_to,
        activity: watching ? activityLabel(summary, now) : null,
        activityHot: watching && isHot(summary, proposal?.status ?? ""),
        overridden: position.overridden === true,
      } satisfies PipelineCard;
    })
    .filter((c): c is PipelineCard => c !== null);
}

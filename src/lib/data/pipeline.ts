import { createClient } from "@/lib/supabase/server";
import { listJobsWithLocation } from "@/lib/data/jobs";
import { isOnPipeline, pipelinePosition, type PipelineStage } from "@/lib/pipeline";

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
}

export async function getPipeline(): Promise<PipelineCard[]> {
  const jobs = await listJobsWithLocation();
  if (jobs.length === 0) return [];

  // One query for every proposal rather than one per job.
  const supabase = await createClient();
  const { data: proposals } = await supabase
    .from("job_proposals")
    .select("job_id, status, total_cost")
    .in(
      "job_id",
      jobs.map((j) => j.id)
    );

  const proposalByJob = new Map(
    ((proposals ?? []) as { job_id: string; status: string; total_cost: number | null }[]).map((p) => [
      p.job_id,
      p,
    ])
  );

  return jobs
    .map((job) => {
      const proposal = proposalByJob.get(job.id) ?? null;
      const input = {
        status: job.status,
        evaluationStatus: job.evaluation_status,
        evaluationDate: job.evaluation_date,
        projectStartDate: job.project_start_date,
        projectEndDate: job.project_end_date,
        proposalStatus: proposal?.status ?? null,
      };
      if (!isOnPipeline(input)) return null;

      const position = pipelinePosition(input);
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
      } satisfies PipelineCard;
    })
    .filter((c): c is PipelineCard => c !== null);
}

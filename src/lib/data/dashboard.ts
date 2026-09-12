import { createClient } from "@/lib/supabase/server";
import { listJobsWithLocation } from "@/lib/data/jobs";
import { listProfiles } from "@/lib/data/team";
import {
  buildDashboard,
  isTheirs,
  type DashboardData,
  type DashboardJobInput,
  type DashboardRange,
} from "@/lib/dashboard";
import type { PipelineStage } from "@/lib/pipeline";

export interface DashboardOptions {
  /**
   * Narrow the whole board to one person's work.
   *
   * Theirs means either: they are the account manager on the client, or they
   * are the one assigned to the job. An account manager who evaluated a job
   * for somebody else's client still has to turn up to it, and a board that
   * left it out would be lying about their day.
   */
  forProfileId?: string;
}

/**
 * The job rows every board is built from, in three queries.
 *
 * Jobs already arrive with their property and customer joined, so the only
 * extra reads are the proposals (for status and value) and the profiles (for
 * turning an id into a name). One query each rather than one per job — the
 * whole point of these pages is that they load in a single go on a phone.
 *
 * Shared rather than duplicated: the dashboard, the personal board and the
 * work queue all read the same rows, so none of them can quietly disagree
 * about what a job is.
 */
export async function loadJobInputs(options: DashboardOptions = {}): Promise<DashboardJobInput[]> {
  const all = await listJobsWithLocation();
  const mine = options.forProfileId;
  const jobs = mine
    ? all.filter((j) =>
        isTheirs({ accountManagerId: j.property.customer.account_manager_id, assignedTo: j.assigned_to }, mine)
      )
    : all;
  if (jobs.length === 0) return [];

  const supabase = await createClient();
  const [{ data: proposals }, profiles] = await Promise.all([
    supabase
      .from("job_proposals")
      .select("job_id, status, total_cost")
      .in(
        "job_id",
        jobs.map((j) => j.id)
      ),
    listProfiles().catch(() => []),
  ]);

  const proposalByJob = new Map(
    ((proposals ?? []) as { job_id: string; status: string; total_cost: number | null }[]).map((p) => [p.job_id, p])
  );
  const nameById = new Map(profiles.map((p) => [p.id, p.full_name || p.email]));

  return jobs.map((job) => {
    const proposal = proposalByJob.get(job.id) ?? null;
    return {
      id: job.id,
      jobNumber: job.job_number,
      jobName: job.name,
      customerName: job.property.customer.name,
      address: job.property.address,
      status: job.status,
      evaluationStatus: job.evaluation_status,
      evaluationDate: job.evaluation_date,
      projectStartDate: job.project_start_date,
      projectEndDate: job.project_end_date,
      completedAt: job.completed_at,
      cancelledAt: job.cancelled_at,
      proposalStatus: proposal?.status ?? null,
      // The pipeline's own two facts, carried so every screen reads the board
      // the same way. Before this only the board itself did, which is how a
      // job somebody moved to Declined stayed on My Day as a client to ring.
      declinedAt: job.declined_at ?? null,
      override:
        job.pipeline_override_stage && job.pipeline_override_status && job.pipeline_override_from
          ? {
              stage: job.pipeline_override_stage as PipelineStage,
              status: job.pipeline_override_status,
              from: job.pipeline_override_from,
            }
          : null,
      dispute: {
        openedAt: job.dispute_opened_at ?? null,
        resolvedAt: job.dispute_resolved_at ?? null,
        kind: job.dispute_kind ?? null,
        reason: job.dispute_reason ?? null,
      },
      value: proposal?.total_cost ?? null,
      personName: job.assigned_to ? (nameById.get(job.assigned_to) ?? null) : null,
    };
  });
}

/** Everything the dashboard shows, for one window. */
export async function getDashboard(
  range: DashboardRange,
  today: Date = new Date(),
  options: DashboardOptions = {}
): Promise<DashboardData> {
  const inputs = await loadJobInputs(options);
  return buildDashboard(inputs, range, today);
}

import { createClient } from "@/lib/supabase/server";
import { listJobsWithLocation } from "@/lib/data/jobs";
import { listProfiles } from "@/lib/data/team";
import { buildDashboard, type DashboardData, type DashboardJobInput, type DashboardRange } from "@/lib/dashboard";

/**
 * Everything the dashboard shows, in three queries.
 *
 * Jobs already arrive with their property and customer joined, so the only
 * extra reads are the proposals (for status and value) and the profiles (for
 * turning an id into a name). One query each rather than one per job — the
 * whole point of this page is that it loads in a single go on a phone.
 */
export async function getDashboard(range: DashboardRange, today: Date = new Date()): Promise<DashboardData> {
  const jobs = await listJobsWithLocation();
  if (jobs.length === 0) return buildDashboard([], range, today);

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

  const inputs: DashboardJobInput[] = jobs.map((job) => {
    const proposal = proposalByJob.get(job.id) ?? null;
    return {
      id: job.id,
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
      value: proposal?.total_cost ?? null,
      personName: job.assigned_to ? (nameById.get(job.assigned_to) ?? null) : null,
    };
  });

  return buildDashboard(inputs, range, today);
}

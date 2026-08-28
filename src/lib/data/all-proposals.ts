import { createClient } from "@/lib/supabase/server";
import { listJobsWithLocation, type JobWithLocation } from "@/lib/data/jobs";
import { NO_VIEWS, viewsForAllProposals } from "@/lib/data/proposal-views";
import { isWarm, viewLabel, type ViewSummary } from "@/lib/proposal-views";
import type { JobProposal } from "@/types/domain";

export interface ProposalWithJob {
  proposal: JobProposal;
  job: JobWithLocation;
  /** How often the client opened it, already worded. Internal only. */
  viewLabel: string;
  /** Opened repeatedly while still unanswered. Worth a phone call. */
  viewsWarm: boolean;
}

export async function listAllProposals(): Promise<ProposalWithJob[]> {
  const supabase = await createClient();
  // All three together. Views used to run after the proposals came back,
  // which is a round trip spent waiting for ids this query does not need.
  const [{ data: proposals, error }, jobs, views] = await Promise.all([
    supabase.from("job_proposals").select("*").order("generated_at", { ascending: false }),
    listJobsWithLocation(),
    viewsForAllProposals().catch(() => ({}) as Record<string, ViewSummary>),
  ]);
  if (error) throw error;

  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const rows: { proposal: JobProposal; job: JobWithLocation }[] = [];
  for (const raw of proposals ?? []) {
    const proposal = raw as unknown as JobProposal;
    const job = jobById.get(proposal.job_id);
    if (job) rows.push({ proposal, job });
  }

  // Worded here so the list and the job page can never say it differently.
  const now = new Date();

  return rows.map(({ proposal, job }) => {
    const summary = views[proposal.id] ?? NO_VIEWS;
    return {
      proposal,
      job,
      viewLabel: viewLabel(summary, now),
      viewsWarm: isWarm(summary, proposal.status),
    };
  });
}

import { createClient } from "@/lib/supabase/server";
import { listJobsWithLocation, type JobWithLocation } from "@/lib/data/jobs";
import type { JobProposal } from "@/types/domain";

export interface ProposalWithJob {
  proposal: JobProposal;
  job: JobWithLocation;
}

export async function listAllProposals(): Promise<ProposalWithJob[]> {
  const supabase = await createClient();
  const [{ data: proposals, error }, jobs] = await Promise.all([
    supabase.from("job_proposals").select("*").order("generated_at", { ascending: false }),
    listJobsWithLocation(),
  ]);
  if (error) throw error;

  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const result: ProposalWithJob[] = [];
  for (const raw of proposals ?? []) {
    const proposal = raw as unknown as JobProposal;
    const job = jobById.get(proposal.job_id);
    if (job) result.push({ proposal, job });
  }
  return result;
}

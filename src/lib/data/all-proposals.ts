import { createClient } from "@/lib/supabase/server";
import { listJobsWithLocation, type JobWithLocation } from "@/lib/data/jobs";
import { viewsForProposals } from "@/lib/data/proposal-views";
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
  const [{ data: proposals, error }, jobs] = await Promise.all([
    supabase.from("job_proposals").select("*").order("generated_at", { ascending: false }),
    listJobsWithLocation(),
  ]);
  if (error) throw error;

  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const rows: { proposal: JobProposal; job: JobWithLocation }[] = [];
  for (const raw of proposals ?? []) {
    const proposal = raw as unknown as JobProposal;
    const job = jobById.get(proposal.job_id);
    if (job) rows.push({ proposal, job });
  }

  // One query for the whole list rather than one per row. Worded here so the
  // list and the job page can never say it differently.
  const views: Record<string, ViewSummary> = await viewsForProposals(
    rows.map((r) => r.proposal.id)
  ).catch(() => ({}));
  const now = new Date();

  return rows.map(({ proposal, job }) => {
    const summary = views[proposal.id] ?? { opens: 0, people: 0, firstAt: null, lastAt: null };
    return {
      proposal,
      job,
      viewLabel: viewLabel(summary, now),
      viewsWarm: isWarm(summary, proposal.status),
    };
  });
}

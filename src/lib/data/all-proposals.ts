import { createClient } from "@/lib/supabase/server";
import { listJobsWithLocation, type JobWithLocation } from "@/lib/data/jobs";
import { NO_VIEWS, viewsForAllProposals } from "@/lib/data/proposal-views";
import { isWarm, viewLabel, type ViewSummary } from "@/lib/proposal-views";
import type { JobProposal } from "@/types/domain";

/** One trim the office made after the proposal went out. */
export interface ProposalEdit {
  id: string;
  createdAt: string;
  editedByName: string | null;
  removedZones: { zoneName: string; serviceLabel: string; priceCents: number | null }[];
  removedLines: { zoneName: string; line: string }[];
  previousTotalCents: number | null;
  newTotalCents: number | null;
  note: string | null;
}

export interface ProposalWithJob {
  proposal: JobProposal;
  job: JobWithLocation;
  /** How often the client opened it, already worded. Internal only. */
  viewLabel: string;
  /** Opened repeatedly while still unanswered. Worth a phone call. */
  viewsWarm: boolean;
  /** What has been taken off since it went out, newest first. */
  edits: ProposalEdit[];
}

export async function listAllProposals(): Promise<ProposalWithJob[]> {
  const supabase = await createClient();
  // All three together. Views used to run after the proposals came back,
  // which is a round trip spent waiting for ids this query does not need.
  const [{ data: proposals, error }, jobs, views, edits] = await Promise.all([
    supabase.from("job_proposals").select("*").order("generated_at", { ascending: false }),
    listJobsWithLocation(),
    viewsForAllProposals().catch(() => ({}) as Record<string, ViewSummary>),
    // Tolerated rather than required: before migration 0131 this table does
    // not exist, and a missing history is not a reason for an empty page.
    listProposalEdits(),
  ]);
  if (error) throw error;

  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const rows: { proposal: JobProposal; job: JobWithLocation }[] = [];
  for (const raw of proposals ?? []) {
    const proposal = raw as unknown as JobProposal;
    const job = jobById.get(proposal.job_id);
    if (job) rows.push({ proposal, job });
  }

  const editsByProposal = new Map<string, ProposalEdit[]>();
  for (const row of edits) {
    const list = editsByProposal.get(row.proposal_id) ?? [];
    list.push({
      id: row.id,
      createdAt: row.created_at,
      editedByName: row.edited_by_name,
      removedZones: row.removed_zones ?? [],
      removedLines: row.removed_lines ?? [],
      previousTotalCents: row.previous_total_cents,
      newTotalCents: row.new_total_cents,
      note: row.note,
    });
    editsByProposal.set(row.proposal_id, list);
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
      edits: editsByProposal.get(proposal.id) ?? [],
    };
  });
}

/** Tolerated rather than required: before migration 0131 this table does not
 * exist, and a missing history is not a reason for an empty proposals page. */
async function listProposalEdits(): Promise<ProposalEditRow[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("proposal_edits")
      .select("*")
      .order("created_at", { ascending: false });
    return (data ?? []) as unknown as ProposalEditRow[];
  } catch {
    return [];
  }
}

type ProposalEditRow = {
  id: string;
  proposal_id: string;
  created_at: string;
  edited_by_name: string | null;
  removed_zones: { zoneName: string; serviceLabel: string; priceCents: number | null }[];
  removed_lines: { zoneName: string; line: string }[];
  previous_total_cents: number | null;
  new_total_cents: number | null;
  note: string | null;
};

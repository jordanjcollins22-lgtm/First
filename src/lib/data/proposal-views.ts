import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import { summariseViews, type ViewSummary } from "@/lib/proposal-views";

const EMPTY: ViewSummary = {
  opens: 0,
  people: 0,
  firstAt: null,
  lastAt: null,
  inLastHour: 0,
  inLastDay: 0,
};

/**
 * How often one proposal has been opened.
 *
 * Returns the empty summary when the table is not there yet, so a job page
 * renders normally on a deployment where the migration has not been run. The
 * office sees "not opened yet" for a day rather than an error, which is the
 * right trade for a number that is nice to have.
 */
export async function viewsForProposal(proposalId: string): Promise<ViewSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("proposal_views")
    .select("viewed_at, visitor_hash")
    .eq("proposal_id", proposalId)
    .order("viewed_at", { ascending: false });

  if (error) {
    if (isMissingTable(error)) return EMPTY;
    throw error;
  }

  return summariseViews(
    (data ?? []).map((row) => ({ viewedAt: row.viewed_at, visitorHash: row.visitor_hash }))
  );
}

/**
 * Every proposal's views, grouped, in one query.
 *
 * Takes no ids on purpose. The list page would otherwise have to wait for its
 * proposals to come back before it could ask about views, which is a round
 * trip spent waiting; row level security already limits this to the caller's
 * own organisation, so asking for all of them is both cheaper and no wider.
 */
export async function viewsForAllProposals(): Promise<Record<string, ViewSummary>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("proposal_views")
    .select("proposal_id, viewed_at, visitor_hash");

  if (error) {
    if (isMissingTable(error)) return {};
    throw error;
  }

  const grouped = new Map<string, { viewedAt: string; visitorHash: string | null }[]>();
  for (const row of data ?? []) {
    const list = grouped.get(row.proposal_id) ?? [];
    list.push({ viewedAt: row.viewed_at, visitorHash: row.visitor_hash });
    grouped.set(row.proposal_id, list);
  }

  const byProposal: Record<string, ViewSummary> = {};
  for (const [id, rows] of grouped) byProposal[id] = summariseViews(rows);
  return byProposal;
}

/** The empty summary, for a proposal nobody has opened. */
export const NO_VIEWS = EMPTY;

/**
 * The same, reached through the job rather than the proposal.
 *
 * Saves the job page a round trip: it no longer has to wait for the proposal
 * to come back before it can ask about views, so this joins the batch that
 * loads everything else instead of running after it.
 */
export async function viewsForJob(jobId: string): Promise<ViewSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("proposal_views")
    .select("viewed_at, visitor_hash, job_proposals!inner(job_id)")
    .eq("job_proposals.job_id", jobId);

  if (error) {
    if (isMissingTable(error)) return EMPTY;
    throw error;
  }

  return summariseViews(
    (data ?? []).map((row) => ({ viewedAt: row.viewed_at, visitorHash: row.visitor_hash }))
  );
}

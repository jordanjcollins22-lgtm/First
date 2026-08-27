import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import { summariseViews, type ViewSummary } from "@/lib/proposal-views";

const EMPTY: ViewSummary = { opens: 0, people: 0, firstAt: null, lastAt: null };

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

/** The same, for a list of proposals in one query. */
export async function viewsForProposals(
  proposalIds: string[]
): Promise<Record<string, ViewSummary>> {
  if (proposalIds.length === 0) return {};

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("proposal_views")
    .select("proposal_id, viewed_at, visitor_hash")
    .in("proposal_id", proposalIds);

  const byProposal: Record<string, ViewSummary> = {};
  for (const id of proposalIds) byProposal[id] = EMPTY;
  if (error) {
    if (isMissingTable(error)) return byProposal;
    throw error;
  }

  const grouped = new Map<string, { viewedAt: string; visitorHash: string | null }[]>();
  for (const row of data ?? []) {
    const list = grouped.get(row.proposal_id) ?? [];
    list.push({ viewedAt: row.viewed_at, visitorHash: row.visitor_hash });
    grouped.set(row.proposal_id, list);
  }
  for (const [id, rows] of grouped) byProposal[id] = summariseViews(rows);

  return byProposal;
}

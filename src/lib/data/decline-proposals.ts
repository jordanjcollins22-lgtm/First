import type { SupabaseClient } from "@supabase/supabase-js";

import { isOpenProposal } from "@/lib/proposal-close";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * Close every open proposal on a job the office has declined.
 *
 * Which status each one was in is kept on it, so taking the decline back can
 * put it back exactly where it was rather than guessing.
 */
export async function declineOpenProposals(supabase: Client, jobId: string, profileId: string, at: string): Promise<void> {
  const { data: proposals } = await supabase.from("job_proposals").select("id, status").eq("job_id", jobId);
  for (const proposal of proposals ?? []) {
    if (!isOpenProposal(proposal.status)) continue;
    await supabase
      .from("job_proposals")
      .update({
        status: "declined",
        responded_at: at,
        office_declined_by: profileId,
        office_declined_from: proposal.status,
        updated_at: at,
      })
      .eq("id", proposal.id);
  }
}

/** Put back the proposals the office closed, and only those. A decline the client made stays. */
export async function reopenOfficeDeclined(supabase: Client, jobId: string): Promise<void> {
  const { data: proposals } = await supabase
    .from("job_proposals")
    .select("id, office_declined_from")
    .eq("job_id", jobId)
    .eq("status", "declined")
    // What it said before is the mark of an office close. Who closed it is
    // kept when known, but a job declined before anyone was recorded still
    // has to reopen cleanly.
    .not("office_declined_from", "is", null);
  for (const proposal of proposals ?? []) {
    await supabase
      .from("job_proposals")
      .update({
        status: proposal.office_declined_from ?? "sent",
        responded_at: null,
        office_declined_by: null,
        office_declined_from: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", proposal.id);
  }
}

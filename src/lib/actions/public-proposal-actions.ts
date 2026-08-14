"use server";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The client's Accept/Decline click — no logged-in user exists, so this runs
 * entirely on the service-role client (same pattern as /book). Accepting
 * moves the underlying job to "approved" directly; nothing else touches
 * that transition today, so this is the one real conversion action.
 */
export async function respondToProposal(token: string, response: "accepted" | "declined", note: string) {
  if (response !== "accepted" && response !== "declined") throw new Error("Invalid response.");

  const admin = createAdminClient();
  const { data: proposal, error } = await admin
    .from("job_proposals")
    .select("id, job_id, status")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  if (!proposal) throw new Error("This proposal link isn't valid.");
  if (proposal.status !== "pending") throw new Error("This proposal has already been responded to.");

  const { error: updateError } = await admin
    .from("job_proposals")
    .update({
      status: response,
      responded_at: new Date().toISOString(),
      client_response_note: note.trim() || null,
    })
    .eq("id", proposal.id);
  if (updateError) throw updateError;

  if (response === "accepted") {
    const { error: jobError } = await admin.from("jobs").update({ status: "approved" }).eq("id", proposal.job_id);
    if (jobError) throw jobError;
  }
}

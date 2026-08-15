"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createAndSendInvoice } from "@/lib/invoicing";
import { notifyJobTeam } from "@/lib/notifications";

/**
 * The client's Accept/Decline click — no logged-in user exists, so this runs
 * entirely on the service-role client (same pattern as /book). Accepting
 * moves the underlying job to "approved" directly and sends the invoice;
 * nothing else touches that transition today, so this is the one real
 * conversion action.
 */
export async function respondToProposal(token: string, response: "accepted" | "declined", note: string) {
  if (response !== "accepted" && response !== "declined") throw new Error("Invalid response.");

  const admin = createAdminClient();
  const { data: proposal, error } = await admin
    .from("job_proposals")
    .select("id, job_id, status, total_cost, discount_amount")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  if (!proposal) throw new Error("This proposal link isn't valid.");
  if (proposal.status === "needs_approval") throw new Error("This proposal isn't ready yet — check back soon.");
  if (proposal.status !== "sent") throw new Error("This proposal has already been responded to.");

  const { error: updateError } = await admin
    .from("job_proposals")
    .update({
      status: response,
      responded_at: new Date().toISOString(),
      client_response_note: note.trim() || null,
    })
    .eq("id", proposal.id);
  if (updateError) throw updateError;

  notifyJobTeam(
    proposal.job_id,
    "proposal_responses",
    `A client ${response} their proposal.`,
    { dedupeKey: proposal.id }
  ).catch(() => {
    // Best-effort — the client's response is already recorded.
  });

  if (response === "accepted") {
    const { error: jobError } = await admin.from("jobs").update({ status: "approved" }).eq("id", proposal.job_id);
    if (jobError) throw jobError;

    const amountDue = Math.max(0, Math.round((proposal.total_cost ?? 0) - proposal.discount_amount));
    createAndSendInvoice(proposal.job_id, proposal.id, amountDue).catch(() => {
      // Best-effort — the acceptance itself already succeeded either way.
    });
  }

  revalidatePath(`/jobs/${proposal.job_id}`);
  revalidatePath("/proposals");
}

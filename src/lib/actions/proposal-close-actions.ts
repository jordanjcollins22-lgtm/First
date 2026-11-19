"use server";

import { revalidatePath } from "next/cache";

import { isAccountManager } from "@/lib/affiliate-roles";
import { getCurrentProfile } from "@/lib/data/team";
import {
  closeBlocker,
  closeUpdate,
  type CloseOutcome,
} from "@/lib/proposal-outcome";
import { revalidateJobViews } from "@/lib/revalidate-job";
import { isOwnerLevel } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type CloseResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * Close a proposal the client has not answered: Yes means we won it, No
 * means we lost it, and either one needs a reason.
 *
 * Won moves the job to approved, the same as the client accepting, but
 * sends nothing: the client already said yes somewhere else, and the
 * proposal link still lets them choose how to pay. Lost is the office's
 * decline, which the win-back texts skip.
 */
export async function closeOpenProposal(
  proposalId: string,
  outcome: CloseOutcome,
  reason: string,
): Promise<CloseResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (
    !isOwnerLevel(profile.roles) &&
    !profile.roles.includes("admin") &&
    !isAccountManager(profile.roles)
  ) {
    return {
      ok: false,
      error: "Only the account manager or the owner can close a proposal.",
    };
  }
  const blocker = closeBlocker(outcome, reason);
  if (blocker) return { ok: false, error: blocker };

  const sb = await createClient();
  const { data: proposal, error: readError } = await sb
    .from("job_proposals")
    .select("id, job_id, status, organization_id")
    .eq("id", proposalId)
    .maybeSingle();
  if (readError)
    return { ok: false, error: "That didn't go through. Try again." };
  if (!proposal || proposal.organization_id !== profile.organization_id)
    return { ok: false, error: "That proposal isn't there any more." };
  if (proposal.status !== "sent")
    return { ok: false, error: "The client already answered this one." };

  const { data: saved, error } = await sb
    .from("job_proposals")
    .update(closeUpdate(outcome, reason, profile.id, new Date()))
    .eq("id", proposal.id)
    .eq("status", "sent")
    .select("id");
  if (error) {
    // The columns for the reason come from migration 0389. Until it is in,
    // say so instead of closing a proposal without its why.
    if (/close_reason|closed_by|closed_at/.test(error.message)) {
      return {
        ok: false,
        error:
          "The reason can't be saved yet: the database update for this (0389) still needs pasting.",
      };
    }
    return { ok: false, error: "That didn't go through. Try again." };
  }
  if (!saved?.length)
    return { ok: false, error: "The client already answered this one." };

  if (outcome === "won") {
    await sb
      .from("jobs")
      .update({ status: "approved" })
      .eq("id", proposal.job_id)
      .in("status", ["quoted", "estimating"]);
  }

  revalidateJobViews(proposal.job_id);
  revalidatePath("/");
  return {
    ok: true,
    message: outcome === "won" ? "Closed as won." : "Closed as lost.",
  };
}

"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { isAccountManager } from "@/lib/affiliate-roles";
import { isOwnerLevel } from "@/lib/roles";
import { approveProposal, updateProposalDraft } from "@/lib/actions/proposal-actions";
import { spreadPrice } from "@/lib/price-approval";
import type { ProposalZoneSnapshot } from "@/types/domain";

export type PriceResult = { ok: true; sendTo: string | null } | { ok: false; error: string };

async function mayPrice(): Promise<string | null> {
  const profile = await getCurrentProfile();
  if (!profile) return "Sign in first.";
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin") && !isAccountManager(profile.roles)) {
    return "Only an owner, admin or account manager can price a proposal.";
  }
  return null;
}

/** Accept price: the proposal as priced is approved, ready to send. Nothing goes to the client yet. */
export async function acceptPrice(jobId: string): Promise<PriceResult> {
  const denied = await mayPrice();
  if (denied) return { ok: false, error: denied };
  try {
    const { sendTo } = await approveProposal(jobId);
    revalidatePath("/my-day");
    return { ok: true, sendTo };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't accept that price." };
  }
}

/**
 * Decline price: the typed price replaces it, spread across the areas so
 * they still add up, and the proposal is approved at it, ready to send.
 */
export async function setPrice(jobId: string, totalDollars: number): Promise<PriceResult> {
  const denied = await mayPrice();
  if (denied) return { ok: false, error: denied };
  if (!Number.isFinite(totalDollars) || totalDollars <= 0) return { ok: false, error: "Type the price, in dollars." };
  try {
    const supabase = await createClient();
    const { data: proposal } = await supabase.from("job_proposals").select("scope_snapshot").eq("job_id", jobId).maybeSingle();
    if (!proposal) return { ok: false, error: "There is no proposal on this job." };
    const snapshot = (proposal.scope_snapshot ?? []) as unknown as ProposalZoneSnapshot[];
    await updateProposalDraft(jobId, { totalCost: totalDollars, scopeSnapshot: spreadPrice(snapshot, totalDollars) });
    const { sendTo } = await approveProposal(jobId);
    revalidatePath("/my-day");
    return { ok: true, sendTo };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't set that price." };
  }
}

"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { isAccountManager } from "@/lib/affiliate-roles";
import { isOwnerLevel } from "@/lib/roles";
import { approveProposal, updateProposalDraft } from "@/lib/actions/proposal-actions";
import { spreadPrice } from "@/lib/price-approval";
import { forwardPriceForJob } from "@/lib/data/forward-price";
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

/**
 * The price worked out again here from the services sent (never taken from
 * the page), and saved to the proposal: each area at its services' price,
 * the services kept on it. Not approved.
 */
async function saveForwardPrice(jobId: string, lines: unknown): Promise<{ ok: true; totalCents: number } | { ok: false; error: string }> {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const priced = await forwardPriceForJob(supabase, profile!.organization_id, jobId, lines);
  if (!priced.ok) return { ok: false, error: priced.error };
  await updateProposalDraft(jobId, { totalCost: priced.totalCents / 100, scopeSnapshot: priced.snapshot });
  return { ok: true, totalCents: priced.totalCents };
}

/**
 * Saves the price as it stands on the card, without approving it, so the
 * job page and the proposal say the same price while it is being worked
 * on, wording approved or not. Only for a proposal not yet sent to the
 * client: one they have seen keeps its price until it is accepted again.
 */
export async function savePriceDraft(jobId: string, lines: unknown): Promise<{ ok: true; totalCents: number } | { ok: false; error: string }> {
  const denied = await mayPrice();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await createClient();
    const { data: proposal } = await supabase.from("job_proposals").select("status, sent_at").eq("job_id", jobId).maybeSingle();
    if (!proposal) return { ok: false, error: "There is no proposal on this job." };
    if (proposal.sent_at || !(proposal.status === "needs_approval" || proposal.status === "sent")) return { ok: false, error: "This proposal has gone to the client." };
    return await saveForwardPrice(jobId, lines);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't save that price." };
  }
}

/**
 * Accept price: the proposal is approved, ready to send. Nothing goes to the
 * client yet. With the services it was priced from, the price is worked out
 * again here from them with the forward pricing equation (never taken from
 * the page), each area set to its services' price and the services kept on
 * it; without, it is approved as it was priced.
 */
export async function acceptPrice(jobId: string, lines?: unknown): Promise<PriceResult> {
  const denied = await mayPrice();
  if (denied) return { ok: false, error: denied };
  try {
    if (lines !== undefined) {
      const saved = await saveForwardPrice(jobId, lines);
      if (!saved.ok) return saved;
    }
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

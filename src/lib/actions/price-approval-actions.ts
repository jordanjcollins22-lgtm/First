"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { isAccountManager } from "@/lib/affiliate-roles";
import { isOwnerLevel } from "@/lib/roles";
import { approveProposal, updateProposalDraft } from "@/lib/actions/proposal-actions";
import { spreadPrice } from "@/lib/price-approval";
import { priceForward, readLines } from "@/lib/forward-pricing";
import { getProductionPricing } from "@/lib/data/production-pricing";
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
      const supabase = await createClient();
      const { data: proposal } = await supabase.from("job_proposals").select("scope_snapshot").eq("job_id", jobId).maybeSingle();
      if (!proposal) return { ok: false, error: "There is no proposal on this job." };
      const snapshot = (proposal.scope_snapshot ?? []) as unknown as ProposalZoneSnapshot[];
      const profile = await getCurrentProfile();
      const pricing = await getProductionPricing(supabase, profile!.organization_id);
      const read = readLines(lines, snapshot.length, pricing.services);
      if (!read) return { ok: false, error: "The areas have changed since this opened. Reload the page." };
      const priced = priceForward(read, pricing.equation, pricing.services);
      if (priced.rCents <= 0) return { ok: false, error: "Every service is at nothing. Put in the quantities first." };
      const repriced = snapshot.map((zone, i) => ({ ...zone, priceCents: priced.areas[i].rCents, priceDerived: true, lines: read[i] }));
      await updateProposalDraft(jobId, { totalCost: priced.rCents / 100, scopeSnapshot: repriced });
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

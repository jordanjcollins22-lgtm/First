"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { refuseInDemo } from "@/lib/demo-mode";
import { isOwnerLevel } from "@/lib/roles";
import { isAccountManager } from "@/lib/affiliate-roles";
import { revalidateJobViews } from "@/lib/revalidate-job";
import { phaseNote, phaseOnePriceProblem, phaseOneSnapshot } from "@/lib/win-back";
import type { ProposalZoneSnapshot } from "@/types/domain";

export type WinBackResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Turns a declined proposal into its Phase 1: the ticked areas at the typed
 * price, back to waiting for a yes. Nothing goes to the client from here: it
 * lands in the price approvals like any other proposal, where Preview and
 * Send to client do that when somebody presses them. The areas left off are
 * written on the job as Phase 2.
 */
export async function makePhaseOne(input: { jobId: string; keep: string[]; price: number }): Promise<WinBackResult> {
  await refuseInDemo();
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin") && !isAccountManager(profile.roles)) {
    return { ok: false, message: "Only an owner, admin or account manager can do this." };
  }

  const supabase = await createClient();
  const { data: proposal, error } = await supabase
    .from("job_proposals")
    .select("id, organization_id, status, total_cost, discount_amount, scope_snapshot")
    .eq("job_id", input.jobId)
    .maybeSingle();
  if (error || !proposal) return { ok: false, message: "Couldn't find that proposal." };
  if (proposal.status !== "declined") return { ok: false, message: "This proposal isn't declined any more. Refresh the page." };

  const declinedTotal = Math.max(0, Number(proposal.total_cost ?? 0) - Number(proposal.discount_amount ?? 0));
  const price = Math.round(Number(input.price) * 100) / 100;
  const problem = phaseOnePriceProblem(price, declinedTotal);
  if (problem) return { ok: false, message: problem };

  const snapshot = (proposal.scope_snapshot ?? []) as unknown as ProposalZoneSnapshot[];
  const kept = phaseOneSnapshot(snapshot, input.keep);
  if (!kept) return { ok: false, message: "Tick at least one area for Phase 1." };
  const later = snapshot.filter((z) => !kept.includes(z)).map((z) => `${z.zoneName} (${z.serviceLabel})`);

  // Per-area prices on the snapshot were never recorded, so they are cleared
  // rather than left saying something the new total doesn't add up to.
  const phase = kept.map((z) => ({ ...z, priceCents: null, priceDerived: false }));
  const { error: updateError } = await supabase
    .from("job_proposals")
    .update({
      status: "needs_approval",
      total_cost: price,
      scope_snapshot: phase,
      discount_id: null,
      discount_kind: null,
      discount_value: null,
      discount_amount: 0,
      discount_reason: null,
      responded_at: null,
      approved_at: null,
      sent_at: null,
      expires_at: null,
    })
    .eq("id", proposal.id)
    .eq("status", "declined");
  if (updateError) return { ok: false, message: "Couldn't save Phase 1. Try again." };

  const by = profile.full_name || profile.email || "the office";
  await supabase.from("job_messages").insert({
    job_id: input.jobId,
    organization_id: proposal.organization_id,
    channel: "internal",
    author_type: "team",
    author_profile_id: profile.id,
    author_name: by,
    body: phaseNote({ declinedTotal, price, kept: kept.map((z) => `${z.zoneName} (${z.serviceLabel})`), later, by }),
  });

  revalidateJobViews(input.jobId);
  revalidatePath("/sales");
  revalidatePath("/my-day");
  return { ok: true, message: "Phase 1 is in the price approvals. Preview the email there, then send it." };
}

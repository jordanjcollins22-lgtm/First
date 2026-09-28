"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { isAccountManager } from "@/lib/affiliate-roles";
import { advanceProjects } from "@/lib/data/commission-advances";
import { whyNotAdvance } from "@/lib/commission-advance";

type Result = { ok: true; message: string } | { ok: false; error: string };

/** Who says yes to an advance and sends it: the owner, and whoever sends the money. */
function approves(roles: string[]): boolean {
  return isOwnerLevel(roles) || roles.includes("admin") || roles.includes("overhead");
}

function refresh() {
  revalidatePath("/my-day");
  revalidatePath("/admin/payments");
}

/** An account manager asks for part of a project's commission now. */
export async function requestAdvance(input: { jobId: string; amount: number; reason: string }): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!isAccountManager(profile.roles)) return { ok: false, error: "Advances are for account managers, on the projects they manage." };
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "Say what it's for." };

  // The room is worked out again here, not trusted from the screen.
  const project = (await advanceProjects(profile)).find((p) => p.jobId === input.jobId);
  const why = whyNotAdvance(input.amount, project?.room ?? 0);
  if (why) return { ok: false, error: why };

  const supabase = await createClient();
  const { error } = await supabase.from("commission_advances").insert({
    organization_id: profile.organization_id,
    profile_id: profile.id,
    job_id: input.jobId,
    amount: Math.round(input.amount * 100) / 100,
    reason: reason.slice(0, 500),
  });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, message: "Asked. It's waiting on approval." };
}

/** Take back a request nobody has answered yet. */
export async function withdrawAdvance(id: string): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commission_advances")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("profile_id", profile.id)
    .eq("status", "requested")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "It's already been answered." };
  refresh();
  return { ok: true, message: "Withdrawn." };
}

/** Yes or no, with a word on why. */
export async function decideAdvance(id: string, approve: boolean, note: string): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!approves(profile.roles)) return { ok: false, error: "Only the owner approves advances." };
  if (!approve && !note.trim()) return { ok: false, error: "Say why not, so they know." };
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("commission_advances")
    .update({ status: approve ? "approved" : "declined", decided_by: profile.id, decided_at: now, decision_note: note.trim() || null, updated_at: now })
    .eq("id", id)
    .eq("status", "requested")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "It's already been answered." };
  refresh();
  return { ok: true, message: approve ? "Approved. Pay it when it's sent." : "Declined." };
}

/**
 * It has been sent. Written as a commission payout against the project, so
 * it counts as paid on it and comes off what is owed when the commission is
 * due.
 */
export async function payAdvance(id: string, input: { method: string; reference: string }): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!approves(profile.roles)) return { ok: false, error: "Only the owner pays advances." };
  const supabase = await createClient();
  const { data: advance } = await supabase
    .from("commission_advances")
    .select("id, organization_id, profile_id, job_id, amount, status, reason")
    .eq("id", id)
    .maybeSingle();
  if (!advance) return { ok: false, error: "Couldn't find that advance." };
  if (advance.status !== "approved") return { ok: false, error: advance.status === "paid" ? "It's already paid." : "Approve it first." };

  const now = new Date().toISOString();
  const { data: payout, error: payoutError } = await supabase
    .from("commission_payouts")
    .insert({
      organization_id: advance.organization_id,
      profile_id: advance.profile_id,
      job_id: advance.job_id,
      amount: Number(advance.amount),
      paid_at: now,
      method: input.method.trim() || null,
      reference: input.reference.trim() || null,
      note: `Advance${advance.reason ? `: ${advance.reason}` : ""}`,
      recorded_by: profile.id,
    })
    .select("id")
    .single();
  if (payoutError || !payout) return { ok: false, error: payoutError?.message ?? "Couldn't record the payment." };

  const { error } = await supabase
    .from("commission_advances")
    .update({
      status: "paid",
      paid_at: now,
      paid_by: profile.id,
      method: input.method.trim() || null,
      reference: input.reference.trim() || null,
      payout_id: payout.id,
      updated_at: now,
    })
    .eq("id", id);
  if (error) {
    // Not left half done: the payout goes if the advance can't say it was paid.
    await supabase.from("commission_payouts").delete().eq("id", payout.id);
    return { ok: false, error: error.message };
  }
  refresh();
  return { ok: true, message: "Paid, and recorded against the project's commission." };
}

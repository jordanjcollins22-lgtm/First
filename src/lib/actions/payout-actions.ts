"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, listProfiles } from "@/lib/data/team";
import { getCommissionFor } from "@/lib/data/commission";
import { listPayoutRequests } from "@/lib/data/payout-requests";
import { tellOwner } from "@/lib/data/back-office-owners";
import { recordCommissionPaid } from "@/lib/actions/commission-actions";
import { refuseInDemo } from "@/lib/demo-mode";
import { isOwnerLevel } from "@/lib/roles";
import { allocatePayout, walletFor, whyNotRequest } from "@/lib/wallet";

/**
 * Payouts from the in-app wallet. Asking is only asking: nothing leaves the
 * business until the owner approves it and whoever sends the money marks it
 * sent, which is when it comes out of the wallet.
 */

type Result = { ok: true; message: string } | { ok: false; error: string };

const dollars = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Who says yes to a payout: the same people who say yes to an advance. */
function approves(roles: string[]): boolean {
  return isOwnerLevel(roles) || roles.includes("admin") || roles.includes("overhead");
}

const db = async () => (await createClient()) as unknown as SupabaseClient;

function refresh() {
  revalidatePath("/me");
  revalidatePath("/admin/payments");
}

/** Ask the office to send what's ready in the wallet to their bank. */
export async function requestPayout(): Promise<Result> {
  await refuseInDemo();
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Sign in again, then try." };
  // Worked out again here, never trusted from the screen.
  const [summary, requests] = await Promise.all([getCommissionFor(profile), listPayoutRequests({ profileId: profile.id })]);
  const wallet = walletFor(summary, requests, []);
  const why = whyNotRequest(wallet);
  if (why) return { ok: false, error: why };

  const supabase = await db();
  const { error } = await supabase.from("payout_requests").insert({
    organization_id: profile.organization_id,
    profile_id: profile.id,
    amount: wallet.ready,
  });
  if (error) return { ok: false, error: error.code === "23505" ? "You already asked. It's with the office." : "Couldn't send that. Try again." };
  await tellOwner(
    profile.organization_id,
    `${profile.full_name || "An affiliate"} asked for a payout of ${dollars(wallet.ready)} from their wallet. Approve it on the Money page.`,
    `payout_request:${profile.id}:${new Date().toISOString().slice(0, 10)}`
  ).catch(() => 0);
  refresh();
  return { ok: true, message: "Asked. The office approves it, then sends it to your bank." };
}

/** Take back a request the office hasn't answered. */
export async function withdrawPayout(id: string): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Sign in again, then try." };
  const supabase = await db();
  const { data, error } = await supabase
    .from("payout_requests")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("profile_id", profile.id)
    .eq("status", "requested")
    .select("id");
  if (error) return { ok: false, error: "Couldn't take it back. Try again." };
  if (!data?.length) return { ok: false, error: "The office has already answered it." };
  refresh();
  return { ok: true, message: "Taken back. The money stays in your wallet." };
}

/** Yes or no, with a word on why when it's no. */
export async function decidePayout(id: string, approve: boolean, note: string): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Sign in again, then try." };
  if (!approves(profile.roles)) return { ok: false, error: "Only the owner approves payouts." };
  if (!approve && !note.trim()) return { ok: false, error: "Say why not, so they know." };
  const supabase = await db();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("payout_requests")
    .update({ status: approve ? "approved" : "declined", decided_by: profile.id, decided_at: now, decision_note: note.trim().slice(0, 500) || null, updated_at: now })
    .eq("id", id)
    .eq("organization_id", profile.organization_id)
    .eq("status", "requested")
    .select("id");
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  if (!data?.length) return { ok: false, error: "It's already been answered." };
  refresh();
  return { ok: true, message: approve ? "Approved. Mark it sent once the money has gone." : "Declined. The money stays in their wallet." };
}

/**
 * The money has gone to their bank. Written down against the jobs it came
 * from, oldest first, so it leaves the wallet and every project still says
 * whether its commission has been paid.
 */
export async function markPayoutSent(id: string, input: { method: string; reference: string }): Promise<Result> {
  await refuseInDemo();
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Sign in again, then try." };
  if (!approves(profile.roles)) return { ok: false, error: "Only whoever sends the money can mark it sent." };
  const supabase = await db();
  const { data: row } = await supabase
    .from("payout_requests")
    .select("id, profile_id, amount, status")
    .eq("id", id)
    .eq("organization_id", profile.organization_id)
    .maybeSingle();
  if (!row) return { ok: false, error: "Couldn't find that request." };
  if (row.status !== "approved") return { ok: false, error: "Approve it first, or it's already sent." };

  const person = (await listProfiles()).find((p) => p.id === row.profile_id);
  if (!person) return { ok: false, error: "Couldn't find who it's for." };
  const summary = await getCommissionFor(person);
  const amount = Number(row.amount) || 0;
  const lines = allocatePayout(summary.lines, amount);
  const covered = lines.reduce((s, l) => s + l.amount, 0);
  if (covered + 0.01 < amount) return { ok: false, error: `Their wallet only has ${dollars(covered)} ready now. Decline this one and have them ask again.` };

  // Claimed first, so two taps can't record it twice.
  const now = new Date().toISOString();
  const method = input.method.trim().slice(0, 80) || null;
  const reference = input.reference.trim().slice(0, 120) || null;
  const { data: claimed } = await supabase
    .from("payout_requests")
    .update({ status: "sent", sent_at: now, sent_by: profile.id, method, reference, updated_at: now })
    .eq("id", id)
    .eq("status", "approved")
    .select("id");
  if (!claimed?.length) return { ok: false, error: "It's already been marked sent." };

  const recorded = await recordCommissionPaid({ profileId: person.id, lines, paidAt: now, method, reference, note: "Wallet payout" });
  if (!recorded.ok) {
    await supabase.from("payout_requests").update({ status: "approved", sent_at: null, sent_by: null, updated_at: new Date().toISOString() }).eq("id", id);
    return { ok: false, error: recorded.error };
  }
  refresh();
  return { ok: true, message: "Marked sent. It's out of their wallet and in their history." };
}

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { groupPayouts, type PaidOut, type PayoutRequestRow, type PayoutStatus } from "@/lib/wallet";

/** Payout requests from the wallet, newest first: one person's, or everyone's for the office. */
export async function listPayoutRequests(filter: { profileId?: string } = {}): Promise<PayoutRequestRow[]> {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  let query = supabase
    .from("payout_requests")
    .select("id, profile_id, amount, status, requested_at, decided_at, decision_note, sent_at, method, reference, person:profiles!payout_requests_profile_id_fkey(full_name, email)")
    .order("requested_at", { ascending: false })
    .limit(100);
  if (filter.profileId) query = query.eq("profile_id", filter.profileId);
  const { data, error } = await query;
  if (error) throw error;
  type Row = {
    id: string;
    profile_id: string;
    amount: number | string;
    status: PayoutStatus;
    requested_at: string;
    decided_at: string | null;
    decision_note: string | null;
    sent_at: string | null;
    method: string | null;
    reference: string | null;
    person: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null;
  };
  return ((data ?? []) as Row[]).map((r) => {
    const person = Array.isArray(r.person) ? r.person[0] : r.person;
    return {
      id: r.id,
      profileId: r.profile_id,
      person: person?.full_name || person?.email || "Someone",
      amount: Number(r.amount) || 0,
      status: r.status,
      requestedAt: r.requested_at,
      decidedAt: r.decided_at,
      decisionNote: r.decision_note,
      sentAt: r.sent_at,
      method: r.method,
      reference: r.reference,
    };
  });
}

/** What has gone to their bank, one entry per payout. */
export async function myPaidOut(profileId: string): Promise<PaidOut[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commission_payouts")
    .select("amount, paid_at, reference, advance_repayment")
    .eq("profile_id", profileId)
    .order("paid_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = ((data ?? []) as { amount: number; paid_at: string; reference: string | null; advance_repayment?: boolean | null }[]).filter((r) => !r.advance_repayment);
  return groupPayouts(rows);
}

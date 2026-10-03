"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { advanceOwed } from "@/lib/data/commission-advances";
import { splitRepayment } from "@/lib/commission-advance";


type Result = { ok: true } | { ok: false; error: string };

/**
 * Who may say a commission has been paid.
 *
 * The same two roles the Money page itself is gated on. Recording your own
 * commission as paid is the one action here with an obvious reason to be
 * wrong, so it belongs to whoever actually sends it.
 */
function sendsTheMoney(roles: string[]): boolean {
  return roles.includes("admin") || roles.includes("overhead");
}

/**
 * Write down commission that has been handed over.
 *
 * One row per job, even when the payment was one transfer covering six of
 * them: the question an account manager asks is about a project, and a lump
 * with no jobs attached cannot answer it. A reference ties the rows back
 * together for whoever is reconciling a bank statement.
 *
 * Not something an account manager can do for themselves. Recording your own
 * commission as paid is the one action on this screen with an obvious reason
 * to be wrong, so it belongs to whoever actually sends the money.
 */
export async function recordCommissionPaid(input: {
  profileId: string;
  /** The jobs this payment covers, with what went out against each. */
  lines: { jobId: string; amount: number }[];
  paidAt?: string | null;
  method?: string | null;
  reference?: string | null;
  note?: string | null;
}): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!sendsTheMoney(profile.roles)) {
    return { ok: false, error: "Only whoever sends the money can mark it sent." };
  }

  const lines = input.lines.filter((line) => line.jobId && Number(line.amount) > 0);
  if (lines.length === 0) return { ok: false, error: "Nothing to record." };

  // An advance they owe is paid back first: that much of the commission is
  // kept, and written down as paying it back rather than as handed over.
  const owed = (await advanceOwed([input.profileId])).get(input.profileId) ?? 0;
  const split = splitRepayment(
    lines.map((line) => ({ jobId: line.jobId, amount: Math.round(Number(line.amount) * 100) / 100 })),
    owed
  );
  const paidAt = input.paidAt || new Date().toISOString();
  const rows = split.flatMap((line) => [
    ...(line.repay > 0
      ? [
          {
            organization_id: profile.organization_id,
            profile_id: input.profileId,
            job_id: line.jobId,
            amount: line.repay,
            paid_at: paidAt,
            method: "Advance repaid",
            reference: null,
            note: "Kept to pay back an advance",
            recorded_by: profile.id,
            advance_repayment: true,
          },
        ]
      : []),
    ...(line.cash > 0
      ? [
          {
            organization_id: profile.organization_id,
            profile_id: input.profileId,
            job_id: line.jobId,
            amount: line.cash,
            paid_at: paidAt,
            method: input.method ?? null,
            reference: input.reference ?? null,
            note: input.note ?? null,
            recorded_by: profile.id,
            advance_repayment: false,
          },
        ]
      : []),
  ]);

  const supabase = await createClient();
  const { error } = await supabase.from("commission_payouts").insert(rows);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/payments");
  revalidatePath("/my-day");
  return { ok: true };
}

/**
 * Take back a payout somebody recorded by mistake.
 *
 * Deleted rather than reversed with a negative row. A payout that never
 * happened is not a transaction, it is a typo, and a ledger full of
 * corrections nobody made is harder to read than one that is simply right.
 */
export async function undoCommissionPaid(payoutId: string): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!sendsTheMoney(profile.roles)) {
    return { ok: false, error: "Only whoever sends the money can take it back." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("commission_payouts").delete().eq("id", payoutId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/payments");
  revalidatePath("/my-day");
  return { ok: true };
}

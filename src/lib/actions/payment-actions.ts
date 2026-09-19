"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";

/** Results rather than throws — a thrown Server Action loses its message in
 * production and surfaces as an unexplained crash. */
export type PaymentResult = { ok: true } | { ok: false; message: string };

function describe(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const e = err as { message: string; code?: string };
    return `${e.message}${e.code ? ` (${e.code})` : ""}`;
  }
  return "Something went wrong.";
}

export interface RecordPaymentInput {
  profileId: string;
  amount: number;
  hours?: number | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  method?: "cash" | "check" | "transfer" | "other" | null;
  note?: string | null;
  /** Record it as already paid rather than owed. */
  markPaid?: boolean;
}

export async function recordTeamPayment(input: RecordPaymentInput): Promise<PaymentResult> {
  try {
    if (!input.profileId) return { ok: false, message: "Pick who this is for." };
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      return { ok: false, message: "Enter an amount greater than zero." };
    }
    if (input.periodStart && input.periodEnd && input.periodEnd < input.periodStart) {
      return { ok: false, message: "The period ends before it starts." };
    }

    const profile = await getCurrentProfile();
    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();

    const { error } = await supabase.from("team_payments").insert({
      organization_id: organizationId,
      profile_id: input.profileId,
      amount: input.amount,
      hours: input.hours ?? null,
      period_start: input.periodStart || null,
      period_end: input.periodEnd || null,
      method: input.method ?? null,
      note: input.note?.trim() || null,
      status: input.markPaid ? "paid" : "pending",
      paid_at: input.markPaid ? new Date().toISOString().slice(0, 10) : null,
      created_by: profile?.id ?? null,
    });
    if (error) return { ok: false, message: describe(error) };

    revalidatePath("/admin/payments");
    return { ok: true };
  } catch (err) {
    console.error("recordTeamPayment failed:", err);
    return { ok: false, message: describe(err) };
  }
}

export async function markTeamPaymentPaid(
  id: string,
  method: "cash" | "check" | "transfer" | "other" | null
): Promise<PaymentResult> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("team_payments")
      .update({ status: "paid", paid_at: new Date().toISOString().slice(0, 10), method })
      .eq("id", id);
    if (error) return { ok: false, message: describe(error) };

    revalidatePath("/admin/payments");
    return { ok: true };
  } catch (err) {
    console.error("markTeamPaymentPaid failed:", err);
    return { ok: false, message: describe(err) };
  }
}

/** For entries recorded by mistake. A payment already marked paid stays —
 * correcting the books is a different thing from deleting the record. */
export async function deleteTeamPayment(id: string): Promise<PaymentResult> {
  try {
    const supabase = await createClient();
    const { data: existing } = await supabase.from("team_payments").select("status").eq("id", id).maybeSingle();
    if (existing?.status === "paid") {
      return { ok: false, message: "That one's already paid — record an adjusting payment instead of deleting it." };
    }

    const { error } = await supabase.from("team_payments").delete().eq("id", id);
    if (error) return { ok: false, message: describe(error) };

    revalidatePath("/admin/payments");
    return { ok: true };
  } catch (err) {
    console.error("deleteTeamPayment failed:", err);
    return { ok: false, message: describe(err) };
  }
}

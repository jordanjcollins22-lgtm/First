"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { canManagePayroll } from "@/lib/data/team-payments";
import type { TeamPaymentMethod, TeamPaymentStatus } from "@/types/domain";

export type PaymentResult = { ok: true; id?: string } | { ok: false; message: string };

const PAGE = "/admin/payments";

function fail(error: { message: string; code?: string }): PaymentResult {
  return { ok: false, message: `${error.message}${error.code ? ` (${error.code})` : ""}` };
}

function describe(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Something went wrong.";
}

/** Every write goes through this first. RLS enforces the same rule, but
 * checking here turns a silent empty-result into a message the user can read. */
async function requirePayrollAccess(): Promise<{ organizationId: string; profileId: string } | string> {
  const profile = await getCurrentProfile();
  if (!profile) return "Not signed in.";
  if (!canManagePayroll(profile.roles)) return "You don't have access to payroll.";
  const organizationId = await getCurrentOrganizationId();
  return { organizationId, profileId: profile.id };
}

export interface RecordPaymentInput {
  profileId: string;
  amount: number;
  status: TeamPaymentStatus;
  method: TeamPaymentMethod | null;
  periodStart: string | null;
  periodEnd: string | null;
  hours: number | null;
  paidAt: string | null;
  note: string | null;
}

export async function recordTeamPayment(input: RecordPaymentInput): Promise<PaymentResult> {
  try {
    const access = await requirePayrollAccess();
    if (typeof access === "string") return { ok: false, message: access };

    if (!input.profileId) return { ok: false, message: "Pick who this is for." };
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      return { ok: false, message: "Enter an amount greater than zero." };
    }
    if (input.periodStart && input.periodEnd && input.periodEnd < input.periodStart) {
      return { ok: false, message: "The period ends before it starts." };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("team_payments")
      .insert({
        organization_id: access.organizationId,
        profile_id: input.profileId,
        amount: input.amount,
        status: input.status,
        method: input.method,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        hours: input.hours,
        // A payment marked paid on the spot is paid today unless told otherwise.
        paid_at: input.status === "paid" ? (input.paidAt ?? new Date().toISOString().slice(0, 10)) : null,
        note: input.note,
        created_by: access.profileId,
      })
      .select("id")
      .single();
    if (error) return fail(error);

    revalidatePath(PAGE);
    return { ok: true, id: data?.id };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/** Settling up: flips a pending row to paid and stamps the date. */
export async function markPaymentPaid(id: string, paidAt?: string): Promise<PaymentResult> {
  try {
    const access = await requirePayrollAccess();
    if (typeof access === "string") return { ok: false, message: access };

    const supabase = await createClient();
    const { error } = await supabase
      .from("team_payments")
      .update({ status: "paid", paid_at: paidAt ?? new Date().toISOString().slice(0, 10) })
      .eq("id", id);
    if (error) return fail(error);

    revalidatePath(PAGE);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/** Undo for a misclick — back to pending, and the paid date goes with it so
 * a reverted row can't still count toward "paid this month". */
export async function markPaymentPending(id: string): Promise<PaymentResult> {
  try {
    const access = await requirePayrollAccess();
    if (typeof access === "string") return { ok: false, message: access };

    const supabase = await createClient();
    const { error } = await supabase
      .from("team_payments")
      .update({ status: "pending", paid_at: null })
      .eq("id", id);
    if (error) return fail(error);

    revalidatePath(PAGE);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

export async function deleteTeamPayment(id: string): Promise<PaymentResult> {
  try {
    const access = await requirePayrollAccess();
    if (typeof access === "string") return { ok: false, message: access };

    const supabase = await createClient();
    const { error } = await supabase.from("team_payments").delete().eq("id", id);
    if (error) return fail(error);

    revalidatePath(PAGE);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { isValidPairing } from "@/lib/ledger";
import type { LedgerCategory, LedgerDirection } from "@/types/domain";

export type LedgerResult = { ok: true; message?: string } | { ok: false; message: string };

/** The ledger is the whole financial picture, so it stays with the people who
 * can already see pay rates and costs. Mirrors the row-level policy. */
async function requireMoneyRole() {
  const profile = await getCurrentProfile();
  const allowed = ["admin", "overhead", "owner"];
  if (!profile?.roles.some((r) => allowed.includes(r))) return null;
  return profile;
}

export interface LedgerEntryInput {
  direction: LedgerDirection;
  category: LedgerCategory;
  amount: number;
  occurredOn: string;
  method: string | null;
  party: string | null;
  jobId: string | null;
  note: string | null;
}

/**
 * Records money moving, in either direction.
 *
 * The direction/category pairing is checked here as well as in the database:
 * the constraint is the guarantee, but a message naming the actual problem
 * beats a raw Postgres violation.
 */
export async function recordLedgerEntry(input: LedgerEntryInput): Promise<LedgerResult> {
  try {
    const profile = await requireMoneyRole();
    if (!profile) return { ok: false, message: "You don't have access to the books." };

    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      return { ok: false, message: "Enter an amount greater than zero." };
    }
    if (!isValidPairing(input.direction, input.category)) {
      return {
        ok: false,
        message: `"${input.category}" isn't a ${input.direction === "in" ? "money-in" : "money-out"} category.`,
      };
    }
    if (!input.occurredOn) return { ok: false, message: "Pick the date it happened." };

    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();

    const { error } = await supabase.from("ledger_entries").insert({
      organization_id: organizationId,
      direction: input.direction,
      category: input.category,
      amount: Math.round(input.amount * 100) / 100,
      occurred_on: input.occurredOn,
      method: input.method || null,
      party: input.party?.trim() || null,
      job_id: input.jobId || null,
      note: input.note?.trim() || null,
      created_by: profile.id,
    });
    if (error) return { ok: false, message: error.message };

    revalidatePath("/admin/payments");
    if (input.jobId) revalidatePath(`/jobs/${input.jobId}`);
    return { ok: true, message: input.direction === "in" ? "Money in recorded." : "Money out recorded." };
  } catch (err) {
    console.error("recordLedgerEntry failed:", err);
    return { ok: false, message: "Couldn't record that." };
  }
}

/** Removes a mistaken entry. There's no soft delete — a wrong number on the
 * books is worse than a missing one, and the entry can just be re-added. */
export async function deleteLedgerEntry(id: string): Promise<LedgerResult> {
  try {
    if (!(await requireMoneyRole())) return { ok: false, message: "You don't have access to the books." };

    const supabase = await createClient();
    const { error } = await supabase.from("ledger_entries").delete().eq("id", id);
    if (error) return { ok: false, message: error.message };

    revalidatePath("/admin/payments");
    return { ok: true, message: "Entry removed." };
  } catch (err) {
    console.error("deleteLedgerEntry failed:", err);
    return { ok: false, message: "Couldn't remove that entry." };
  }
}

"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";

type Result = { ok: true } | { ok: false; error: string };

/**
 * The terms off a card statement, which the bank feed does not carry.
 *
 * Balances arrive by themselves every morning. The rate, the minimum and the
 * due date do not, and without them a card can be shown but not planned for.
 * Typed in once, from the statement, and kept.
 *
 * Money, so it belongs to whoever the Money page belongs to.
 */
export async function updateCardTerms(input: {
  accountId: string;
  apr: number | null;
  minimumPayment: number | null;
  creditLimit: number | null;
  dueDay: number | null;
}): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!profile.roles.includes("admin") && !profile.roles.includes("overhead")) {
    return { ok: false, error: "Only whoever handles the money can set card terms." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("bank_accounts")
    .update({
      apr: clamp(input.apr, 0, 100),
      minimum_payment: clamp(input.minimumPayment, 0, 1_000_000),
      credit_limit: clamp(input.creditLimit, 0, 10_000_000),
      payment_due_day: input.dueDay == null ? null : Math.min(31, Math.max(1, Math.round(input.dueDay))),
    })
    .eq("id", input.accountId)
    // Scoped by the caller's own organization through RLS, but said here too:
    // an id arriving from a form is not a claim to own the row.
    .eq("organization_id", profile.organization_id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/payments");
  return { ok: true };
}

/** A number in range, or null. Anything unreadable is refused rather than stored as nonsense. */
function clamp(value: number | null, low: number, high: number): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(high, Math.max(low, Math.round(n * 100) / 100));
}

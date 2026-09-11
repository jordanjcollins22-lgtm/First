"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";

/**
 * What somebody decided about a recurring charge.
 *
 * The charges are worked out from the transactions every time, so nothing here
 * writes one down. What gets written down is judgement -- whether the
 * fortnightly charge at the bistro is a business expense or lunch, what a
 * merchant is really called, and whether anybody has looked at it yet.
 */

const PATH = "/admin/subscriptions";

export type RecurringResult = { ok: true } | { ok: false; error: string };

async function decide(
  merchantKey: string,
  patch: Record<string, unknown>
): Promise<RecurringResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!merchantKey) return { ok: false, error: "Nothing to decide about." };

  const supabase = await createClient();
  const { error } = await supabase.from("recurring_decisions").upsert(
    {
      organization_id: profile.organization_id,
      merchant_key: merchantKey,
      ...patch,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,merchant_key" }
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

/** Looked at and kept. The difference between "we found this" and "we know". */
export async function confirmCharge(input: {
  merchantKey: string;
  confirmed: boolean;
}): Promise<RecurringResult> {
  return decide(input.merchantKey, {
    confirmed_at: input.confirmed ? new Date().toISOString() : null,
    ...(input.confirmed ? { dismissed_at: null } : {}),
  });
}

/**
 * Not an overhead.
 *
 * Personal, one-off, or the detector got it wrong. Stays on the screen and off
 * the total, so a decision can be seen and undone rather than vanishing.
 */
export async function dismissCharge(input: {
  merchantKey: string;
  dismissed: boolean;
}): Promise<RecurringResult> {
  return decide(input.merchantKey, {
    dismissed_at: input.dismissed ? new Date().toISOString() : null,
    ...(input.dismissed ? { confirmed_at: null, cancel_wanted: false } : {}),
  });
}

/** Flag it to get rid of. The reason anybody opens this screen twice. */
export async function markForCancelling(input: {
  merchantKey: string;
  wanted: boolean;
}): Promise<RecurringResult> {
  return decide(input.merchantKey, { cancel_wanted: input.wanted });
}

/** Rename it, and say what it is if the detector guessed wrong. */
export async function describeCharge(input: {
  merchantKey: string;
  label: string;
  kind: string;
  note: string;
}): Promise<RecurringResult> {
  const kind = ["subscription", "obligation", "transfer"].includes(input.kind) ? input.kind : null;
  return decide(input.merchantKey, {
    label: input.label.trim().slice(0, 80) || null,
    kind,
    note: input.note.trim().slice(0, 300) || null,
  });
}

/**
 * Which bucket this belongs in.
 *
 * Most charges sort themselves from the merchant name and the bank category.
 * The biggest one does not: a landlord trading as "YSI Fieldside" says nothing
 * about being rent, so the largest cost in the business sits in "everything
 * else" until somebody says otherwise. One tap, and it stays said.
 */
export async function setOverheadGroup(input: {
  merchantKey: string;
  group: string | null;
}): Promise<RecurringResult> {
  const groups = [
    "premises",
    "vehicles",
    "insurance",
    "power",
    "water",
    "phone",
    "software",
    "finance",
    "other",
  ];
  const group = input.group && groups.includes(input.group) ? input.group : null;
  return decide(input.merchantKey, { overhead_group: group });
}

/**
 * What this charge actually covers.
 *
 * The bank cannot say, and sometimes it matters more than the amount: the rent
 * here is rent plus the water in some months, and a figure that does not admit
 * that reads as pure rent and gets budgeted against wrongly.
 */
export async function noteCharge(input: {
  merchantKey: string;
  note: string;
}): Promise<RecurringResult> {
  return decide(input.merchantKey, { note: input.note.trim().slice(0, 300) || null });
}

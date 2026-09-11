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

/**
 * Count it anyway.
 *
 * Some real costs never look regular. A vehicle lease billed twice in six
 * months at two different amounts is not a rhythm any detector should trust,
 * and it is still a lease -- so there has to be a way to say "this one counts"
 * about something nothing found. The monthly figure for one of these is what
 * actually left divided by the months it covers, which is the only honest
 * answer for spending with no pattern.
 */
export async function includeCharge(input: {
  merchantKey: string;
  included: boolean;
}): Promise<RecurringResult> {
  return decide(input.merchantKey, {
    included_at: input.included ? new Date().toISOString() : null,
    ...(input.included ? { dismissed_at: null } : {}),
  });
}

/**
 * Which amount this charge is worth from here.
 *
 * The median by default, so one odd month does not move it. That is right for
 * a bill that wobbles and wrong for one that stepped up: the rent ran at 2,298
 * and went to 2,791, and the median of the two is a figure the business has
 * never paid and never will. Which of the two is happening cannot be read off
 * the numbers, so it is a choice somebody makes with the history in front of
 * them.
 */
export async function setAmountBasis(input: {
  merchantKey: string;
  basis: string | null;
}): Promise<RecurringResult> {
  const basis = input.basis === "latest" || input.basis === "median" ? input.basis : null;
  return decide(input.merchantKey, { amount_basis: basis });
}

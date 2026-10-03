"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { describeDbError } from "@/lib/setup-errors";
import { findDuplicateCustomer } from "@/lib/dedupe";
import {
  FLYER_CHANNEL_KEY,
  FLYER_CHANNEL_NAME,
  OUTCOMES,
  type FlyerOutcome,
} from "@/lib/flyer-outreach";

const PATH = "/admin/flyer";

export type OutreachResult = { ok: true; message?: string } | { ok: false; message: string };

/**
 * The channel these touches hang off, found or made once.
 *
 * outreach_touches needs a channel, and asking somebody to create one before
 * they can log their first call is a step nobody would forgive. So it is
 * conjured on first use and never mentioned again.
 */
async function flyerChannelId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("outreach_channels")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("key", FLYER_CHANNEL_KEY)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created } = await supabase
    .from("outreach_channels")
    .insert({
      organization_id: organizationId,
      key: FLYER_CHANNEL_KEY,
      name: FLYER_CHANNEL_NAME,
      temperature: "cold",
      cost_type: "free",
      summary: "Local businesses approached about a spot on the flyer.",
    })
    .select("id")
    .maybeSingle();

  return created?.id ?? null;
}

/**
 * Add a business to the call list.
 *
 * Filed as a contact rather than a list of its own, because the shop that
 * buys a flyer spot this month is the shop that might want a patio next
 * spring, and two address books is how one of them goes stale.
 */
export async function addFlyerBusiness(input: {
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
}): Promise<OutreachResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };
    const name = input.name.trim();
    if (!name) return { ok: false, message: "Give the business a name." };

    const [supabase, organizationId] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
    ]);

    // The same ladder the import uses, so ringing a business we already know
    // does not create a second card for them.
    const { data: existing } = await supabase
      .from("customers")
      .select("id, name, email, phone")
      .eq("organization_id", organizationId);

    const duplicate = findDuplicateCustomer((existing ?? []) as never, {
      name,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
    }) as { id: string; name: string } | null;

    if (duplicate) {
      // Already here under another heading. Marking them a business is the
      // right move; a second row is not.
      const { error } = await supabase
        .from("customers")
        .update({ contact_type: "business" })
        .eq("id", duplicate.id);
      if (error) return { ok: false, message: describeDbError(error) };
      revalidatePath(PATH);
      return { ok: true, message: `${duplicate.name} was already in your contacts. Marked as a business.` };
    }

    const { error } = await supabase.from("customers").insert({
      organization_id: organizationId,
      name,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      notes: input.notes?.trim() || null,
      contact_type: "business",
    });
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath(PATH);
    revalidatePath("/attractors");
    return { ok: true, message: `${name} added.` };
  } catch (err) {
    console.error("addFlyerBusiness failed:", err);
    return { ok: false, message: "Could not add that business." };
  }
}

/**
 * Log one attempt, and what they said.
 *
 * A row per attempt, never a counter. A counter answers "did we do the work";
 * only the rows answer "what happened", which is the question that decides
 * where the next hour goes.
 */
export async function logFlyerTouch(input: {
  customerId: string;
  outcome: string;
  note?: string;
}): Promise<OutreachResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };
    if (!OUTCOMES.some((o) => o.value === input.outcome)) {
      return { ok: false, message: "Pick what they said." };
    }

    const [supabase, organizationId] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
    ]);

    const channelId = await flyerChannelId(supabase, organizationId);
    if (!channelId) {
      return { ok: false, message: "Outreach isn't set up yet. Run the outreach migration first." };
    }

    const { error } = await supabase.from("outreach_touches").insert({
      organization_id: organizationId,
      channel_id: channelId,
      profile_id: profile.id,
      customer_id: input.customerId,
      outcome: input.outcome as FlyerOutcome,
      note: input.note?.trim() || null,
    });
    if (error) return { ok: false, message: describeDbError(error) };

    // Somebody who asked not to be contacted is told once and remembered
    // everywhere, not just on this screen.
    if (input.outcome === "do_not_contact") {
      await supabase.from("customers").update({ do_not_contact: true }).eq("id", input.customerId);
    }

    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    console.error("logFlyerTouch failed:", err);
    return { ok: false, message: "Could not save that." };
  }
}

/**
 * Correct or remove one logged call.
 *
 * The buttons are big and thumbs are inaccurate, so a mis-tap is not an edge
 * case, it is Tuesday. Because the count is derived from the rows rather than
 * stored, deleting the row fixes the count with nothing else to remember.
 */
export async function deleteFlyerTouch(touchId: string): Promise<OutreachResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };
    const supabase = await createClient();
    const { error } = await supabase.from("outreach_touches").delete().eq("id", touchId);
    if (error) return { ok: false, message: describeDbError(error) };
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    console.error("deleteFlyerTouch failed:", err);
    return { ok: false, message: "Could not remove that." };
  }
}

/** Change what a call was recorded as, or fix its note. */
export async function updateFlyerTouch(input: {
  touchId: string;
  outcome: string;
  note?: string;
}): Promise<OutreachResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };
    if (!OUTCOMES.some((o) => o.value === input.outcome)) {
      return { ok: false, message: "Pick what they said." };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("outreach_touches")
      .update({ outcome: input.outcome, note: input.note?.trim() || null })
      .eq("id", input.touchId);
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    console.error("updateFlyerTouch failed:", err);
    return { ok: false, message: "Could not save that." };
  }
}

/**
 * Take the do-not-contact mark off a business.
 *
 * Its own deliberate action rather than something that happens when a
 * do-not-contact call is deleted. The flag can also arrive from a CRM import,
 * and quietly clearing an imported one because somebody tidied up a mis-tap
 * is how a business we were told never to ring gets rung.
 */
export async function clearDoNotContact(customerId: string): Promise<OutreachResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };
    const supabase = await createClient();
    const { error } = await supabase
      .from("customers")
      .update({ do_not_contact: false })
      .eq("id", customerId);
    if (error) return { ok: false, message: describeDbError(error) };
    revalidatePath(PATH);
    return { ok: true, message: "They can be contacted again." };
  } catch (err) {
    console.error("clearDoNotContact failed:", err);
    return { ok: false, message: "Could not change that." };
  }
}

"use server";

import { revalidatePath } from "next/cache";

import { describeDbError } from "@/lib/setup-errors";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { localDay } from "@/lib/data/outreach";
import { OUTCOMES, type Outcome } from "@/lib/outreach";

export type OutreachResult = { ok: true; message?: string } | { ok: false; message: string };

/**
 * Records one attempt to reach somebody.
 *
 * Deliberately the cheapest thing on the page to do. Thirty calls that nobody
 * logged is a day nobody can learn from, and if recording a no-answer costs
 * more than one tap it stops happening by Wednesday.
 *
 * A do-not-contact outcome does two things at once: it logs the touch and it
 * marks the prospect, because the version where somebody has to remember the
 * second step is the version where a person who asked not to be called gets
 * called again next month.
 */
export async function logTouch(
  channelId: string,
  outcome: Outcome,
  options: { prospectId?: string | null; customerId?: string | null; note?: string } = {}
): Promise<OutreachResult> {
  try {
    if (!OUTCOMES.includes(outcome)) return { ok: false, message: "That isn't an outcome." };

    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const [supabase, organizationId] = await Promise.all([createClient(), getCurrentOrganizationId()]);

    const { error } = await supabase.from("outreach_touches").insert({
      organization_id: organizationId,
      channel_id: channelId,
      profile_id: profile.id,
      prospect_id: options.prospectId ?? null,
      customer_id: options.customerId ?? null,
      outcome,
      note: options.note?.trim() || null,
      day: localDay(),
    });
    if (error) return { ok: false, message: describeDbError(error) };

    if (outcome === "do_not_contact" && options.prospectId) {
      await supabase
        .from("lead_prospects")
        .update({ do_not_contact: true, do_not_contact_reason: "Asked us not to contact them" })
        .eq("id", options.prospectId);
    }

    revalidatePath("/leads");
    return { ok: true };
  } catch (err) {
    console.error("logTouch failed:", err);
    return { ok: false, message: "Couldn't log that — try again." };
  }
}

/**
 * Edits a channel's playbook, target or name.
 *
 * The seeded playbooks are a starting point, not the company's opinion set in
 * stone — whoever actually makes the calls knows what works better than the
 * migration that wrote them does, and a playbook nobody can correct is one
 * people quietly stop reading.
 */
export async function updateChannel(
  channelId: string,
  fields: { name?: string; summary?: string; playbook?: string; dailyTarget?: number | null; active?: boolean }
): Promise<OutreachResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const patch: {
      name?: string;
      summary?: string | null;
      playbook?: string | null;
      daily_target?: number | null;
      active?: boolean;
    } = {};
    if (fields.name !== undefined) {
      const name = fields.name.trim();
      if (!name) return { ok: false, message: "A channel needs a name." };
      patch.name = name;
    }
    if (fields.summary !== undefined) patch.summary = fields.summary.trim() || null;
    if (fields.playbook !== undefined) patch.playbook = fields.playbook.trim() || null;
    if (fields.dailyTarget !== undefined) {
      if (fields.dailyTarget != null && (!Number.isFinite(fields.dailyTarget) || fields.dailyTarget < 0)) {
        return { ok: false, message: "A daily target has to be a number, or blank for no target." };
      }
      patch.daily_target = fields.dailyTarget;
    }
    if (fields.active !== undefined) patch.active = fields.active;

    if (Object.keys(patch).length === 0) return { ok: true };

    const supabase = await createClient();
    const { error } = await supabase.from("outreach_channels").update(patch).eq("id", channelId);
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath("/leads");
    return { ok: true };
  } catch (err) {
    console.error("updateChannel failed:", err);
    return { ok: false, message: "Couldn't save that — try again." };
  }
}

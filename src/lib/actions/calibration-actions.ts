"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { canSell, isOwnerLevel } from "@/lib/roles";

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Taking the measurement's word for how long a service takes.
 *
 * The only way a calibration ever reaches the price list. It is a button
 * somebody presses, never a nightly job that quietly moves what the business
 * charges: a price that changed on its own is a price nobody can explain to
 * the client who asks why it went up.
 *
 * The old figure goes in the note rather than being lost, so the change can be
 * argued with afterwards.
 */
export async function applyMeasuredHours(input: {
  serviceTypeId: string;
  hours: number;
  /** What the measurement said, kept with the change. */
  because: string;
}): Promise<ActionResult<{ hours: number }>> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, error: "Not signed in." };
    const roles = (profile.roles ?? []) as string[];
    if (!isOwnerLevel(roles) && !canSell(roles)) {
      return { ok: false, error: "Only the owner or an account manager changes what a service is quoted at." };
    }
    if (!Number.isFinite(input.hours) || input.hours <= 0 || input.hours > 500) {
      return { ok: false, error: "That is not a number of crew-hours." };
    }

    const supabase = await createClient();
    const { data: current } = await supabase
      .from("services")
      .select("estimated_hours, how_to")
      .eq("service_type_id", input.serviceTypeId)
      .eq("organization_id", profile.organization_id as string)
      .maybeSingle();

    const was = current?.estimated_hours ?? null;
    const stamp = `Estimate set to ${input.hours} crew-hours on ${new Date().toISOString().slice(0, 10)}${
      was != null ? ` (was ${was})` : ""
    }. ${input.because}`;

    const { error } = await supabase
      .from("services")
      .update({
        estimated_hours: input.hours,
        // Appended, never replaced: the history of what this was quoted at is
        // worth more than a tidy field.
        how_to: current?.how_to ? `${current.how_to}\n\n${stamp}` : stamp,
      })
      .eq("service_type_id", input.serviceTypeId)
      .eq("organization_id", profile.organization_id as string);
    if (error) throw error;

    revalidatePath("/admin/team");
    revalidatePath("/more");
    return { ok: true, value: { hours: input.hours } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

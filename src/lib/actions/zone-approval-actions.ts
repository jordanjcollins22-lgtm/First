"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import type { RejectReason } from "@/lib/zone-approval";

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** A person's word on a zone: right, or wrong and why. */
export async function reviewZone(input: {
  zoneId: string;
  decision: "approve" | "reject";
  reason?: RejectReason;
  note?: string;
  /** For a wrong mode: the right one, applied at once. */
  newMode?: "foot" | "scooter" | "vehicle";
}): Promise<ActionResult<null>> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, error: "Not signed in." };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("zone_review", {
      org: profile.organization_id,
      the_zone: input.zoneId,
      decision: input.decision,
      reason: input.decision === "reject" ? (input.reason ?? "other") : null,
      note: input.note?.trim() || null,
      new_mode: input.decision === "reject" && input.reason === "mode" ? (input.newMode ?? null) : null,
      by: profile.id,
    });
    if (error) return { ok: false, error: error.message };
    const result = (data ?? {}) as { ok?: boolean; error?: string };
    if (!result.ok) return { ok: false, error: result.error ?? "The zone could not be reviewed." };
    revalidatePath("/attractors");
    return { ok: true, value: null };
  } catch (err) {
    console.error("[zones] reviewZone failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Could not record that." };
  }
}

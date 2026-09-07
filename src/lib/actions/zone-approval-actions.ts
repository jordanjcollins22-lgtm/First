"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import type { RejectReason } from "@/lib/zone-approval";

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * A person's word on a batch of zones they have just looked at.
 *
 * The first ten approvals are what teach the app what a right zone looks
 * like; after that it approves the ordinary ones itself and asks only
 * about the unusual. Making somebody click ten times, then twenty-five,
 * before any of that starts is the manual work this app exists to remove,
 * so a batch on the screen can be approved in one go. Each zone is still
 * recorded as its own decision, because that is what the learning counts.
 */
export async function approveZones(zoneIds: string[]): Promise<ActionResult<{ approved: number; failed: number }>> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, error: "Not signed in." };
    const ids = [...new Set(zoneIds)].slice(0, 100);
    if (ids.length === 0) return { ok: false, error: "Nothing to approve." };
    const supabase = await createClient();
    let approved = 0;
    let failed = 0;
    let lastError: string | null = null;
    for (const zoneId of ids) {
      const { data, error } = await supabase.rpc("zone_review", {
        org: profile.organization_id,
        the_zone: zoneId,
        decision: "approve",
        reason: null,
        note: null,
        new_mode: null,
        by: profile.id,
      });
      const result = (data ?? {}) as { ok?: boolean; error?: string };
      if (error || !result.ok) {
        failed++;
        lastError = error?.message ?? result.error ?? "one could not be approved";
        continue;
      }
      approved++;
    }
    revalidatePath("/attractors");
    if (approved === 0) return { ok: false, error: lastError ?? "None could be approved." };
    return { ok: true, value: { approved, failed } };
  } catch (err) {
    console.error("[zones] approveZones failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Could not record those." };
  }
}

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

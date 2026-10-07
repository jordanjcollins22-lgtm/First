"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { log } from "@/lib/log";

/**
 * Where a crew member's phone says they are.
 *
 * Latest position only, overwritten each time. Nothing is logged about
 * it beyond a failure, because a stream of coordinates in the logs is a
 * location history nobody asked to keep.
 */
export async function reportCrewPosition(input: {
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
}): Promise<{ ok: boolean }> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false };
    if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) return { ok: false };
    if (Math.abs(input.lat) > 90 || Math.abs(input.lng) > 180) return { ok: false };

    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();
    const { error } = await supabase.from("crew_positions").upsert(
      {
        profile_id: profile.id,
        organization_id: organizationId,
        at: new Date().toISOString(),
        lat: input.lat,
        lng: input.lng,
        accuracy_m: input.accuracy != null && Number.isFinite(input.accuracy) ? input.accuracy : null,
        heading: input.heading != null && Number.isFinite(input.heading) ? input.heading : null,
      },
      { onConflict: "profile_id" }
    );
    if (error) {
      log.warn("crew.position.failed", { error: error.message });
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    log.warn("crew.position.failed", { error: err instanceof Error ? err.message : String(err) });
    return { ok: false };
  }
}

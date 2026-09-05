"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { listDoorHangerSlots } from "@/lib/data/door-hangers";
import { isFilled } from "@/lib/door-hanger";
import { parseCoverage, shapeFor, type HouseCoverage } from "@/lib/coverage-shape";
import type { AttractorGeometry, AttractorGeometryType } from "@/types/domain";
import type { Json } from "@/lib/supabase/database.types";

export type CoverageResult = { ok: true; value: HouseCoverage | null } | { ok: false; error: string };

/**
 * How many designs there are to escalate through.
 *
 * One per filled front half of the sheet. A business with no artwork uploaded
 * still has design 1: refusing to number the run would stop a walk over a
 * missing file.
 */
export async function designsAvailable(): Promise<number> {
  const slots = await listDoorHangerSlots().catch(() => []);
  return Math.max(1, slots.filter((s) => s.face === "front" && isFilled(s)).length);
}

/**
 * The doors inside a shape, counted in the database over the whole county.
 *
 * Called while a shape is still being drawn, so it has to be quick and it has
 * to be honest: the number it returns is what gets printed and carried.
 */
export async function houseCoverage(type: AttractorGeometryType, geometry: AttractorGeometry): Promise<CoverageResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, error: "Not signed in." };

    const shape = shapeFor(type, geometry);
    if (!shape) return { ok: true, value: null };

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("houses_coverage", {
      org: profile.organization_id,
      ring: (shape.ring ?? null) as Json,
      zips: (shape.zips ?? null) as Json,
      designs: await designsAvailable(),
    });
    if (error) throw error;
    return { ok: true, value: parseCoverage(data) };
  } catch (err) {
    console.error("[coverage] houseCoverage failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Could not count the houses." };
  }
}

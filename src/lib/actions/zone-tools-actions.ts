"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { describeDbError } from "@/lib/setup-errors";
import type { WorkZone } from "@/components/canvas/types";

export type ZoneToolsResult = { ok: true; message?: string } | { ok: false; message: string };

/**
 * Sets which tools a zone needs.
 *
 * Zones live inside the canvas design's jsonb, so this reads the array,
 * replaces one zone's tool list, and writes it back. Only the tools change —
 * the shape, the service and the checklist answers are left exactly as they
 * were, because this is the account manager adjusting the load-out, not
 * redrawing anybody's survey.
 */
export async function setZoneTools(
  jobId: string,
  zoneId: string,
  toolNames: string[]
): Promise<ZoneToolsResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const { data: design, error: readError } = await supabase
      .from("canvas_designs")
      .select("id, zones")
      .eq("job_id", jobId)
      .maybeSingle();
    if (readError) return { ok: false, message: describeDbError(readError) };
    if (!design) return { ok: false, message: "This job has no site plan yet." };

    const zones = (design.zones as unknown as WorkZone[]) ?? [];
    let found = false;

    const next = zones.map((zone) => {
      if (zone.id !== zoneId || !zone.service) return zone;
      found = true;
      return { ...zone, service: { ...zone.service, tools: toolNames } };
    });

    if (!found) return { ok: false, message: "Couldn't find that zone — reload and try again." };

    const { error } = await supabase
      .from("canvas_designs")
      .update({ zones: next as unknown as never })
      .eq("id", design.id);
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/today");
    return { ok: true, message: "Tools updated." };
  } catch (err) {
    console.error("setZoneTools failed:", err);
    return { ok: false, message: "Couldn't save those tools." };
  }
}

/**
 * Empties every zone's tool list on a job.
 *
 * For the jobs carrying tools nobody picked: the survey used to attach the
 * service's whole list on save, so clearing them one zone at a time would mean
 * a lot of tapping to undo something that was never chosen.
 */
export async function clearAllZoneTools(jobId: string): Promise<ZoneToolsResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const { data: design, error: readError } = await supabase
      .from("canvas_designs")
      .select("id, zones")
      .eq("job_id", jobId)
      .maybeSingle();
    if (readError) return { ok: false, message: describeDbError(readError) };
    if (!design) return { ok: false, message: "This job has no site plan yet." };

    const zones = (design.zones as unknown as WorkZone[]) ?? [];
    const next = zones.map((zone) =>
      zone.service ? { ...zone, service: { ...zone.service, tools: [] } } : zone
    );

    const { error } = await supabase
      .from("canvas_designs")
      .update({ zones: next as unknown as never })
      .eq("id", design.id);
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/today");
    return { ok: true, message: "Cleared every zone." };
  } catch (err) {
    console.error("clearAllZoneTools failed:", err);
    return { ok: false, message: "Couldn't clear those tools." };
  }
}

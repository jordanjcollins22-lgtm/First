"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { clusterWorkAreasIntoZones } from "@/lib/zone-clustering";
import type { Feature, Geometry } from "geojson";

function revalidateJob(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/crew`);
}

/**
 * Recomputes zones for a job from scratch based on current work area
 * proximity. This replaces any auto-named zones; manually renamed zones
 * (auto_named = false) are preserved by best-effort name matching against
 * the new cluster whose members overlap most with the old zone.
 */
export async function autoClusterZones(jobId: string) {
  const supabase = await createClient();

  const { data: workAreas, error: waError } = await supabase
    .from("work_areas")
    .select("id, geometry, zone_id")
    .eq("job_id", jobId);
  if (waError) throw waError;
  if (!workAreas || workAreas.length === 0) return;

  const { data: existingZones, error: zoneError } = await supabase
    .from("zones")
    .select("*")
    .eq("job_id", jobId);
  if (zoneError) throw zoneError;

  const clusters = clusterWorkAreasIntoZones(
    workAreas.map((wa) => ({
      id: wa.id,
      geometry: wa.geometry as Feature<Geometry>,
    }))
  );

  const manualZones = (existingZones ?? []).filter((z) => !z.auto_named);
  const zoneMembersOf = (zoneId: string) =>
    new Set(workAreas.filter((wa) => wa.zone_id === zoneId).map((wa) => wa.id));

  // Delete auto-named zones; work_areas.zone_id cascades to null via FK.
  const autoZoneIds = (existingZones ?? [])
    .filter((z) => z.auto_named)
    .map((z) => z.id);
  if (autoZoneIds.length > 0) {
    const { error } = await supabase.from("zones").delete().in("id", autoZoneIds);
    if (error) throw error;
  }

  for (const cluster of clusters) {
    const clusterSet = new Set(cluster.workAreaIds);
    const matchingManualZone = manualZones.find((z) => {
      const members = zoneMembersOf(z.id);
      let overlap = 0;
      members.forEach((id) => {
        if (clusterSet.has(id)) overlap += 1;
      });
      return overlap > 0 && overlap >= members.size / 2;
    });

    if (matchingManualZone) {
      const { error } = await supabase
        .from("work_areas")
        .update({ zone_id: matchingManualZone.id })
        .in("id", cluster.workAreaIds);
      if (error) throw error;
      continue;
    }

    const { data: zone, error: insertError } = await supabase
      .from("zones")
      .insert({ job_id: jobId, name: cluster.name, auto_named: true })
      .select()
      .single();
    if (insertError) throw insertError;

    const { error: assignError } = await supabase
      .from("work_areas")
      .update({ zone_id: zone.id })
      .in("id", cluster.workAreaIds);
    if (assignError) throw assignError;
  }

  revalidateJob(jobId);
}

export async function renameZone(zoneId: string, jobId: string, name: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("zones")
    .update({ name, auto_named: false })
    .eq("id", zoneId);
  if (error) throw error;
  revalidateJob(jobId);
}

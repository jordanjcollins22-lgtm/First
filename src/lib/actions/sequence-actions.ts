"use server";

import { revalidatePath } from "next/cache";
import * as turf from "@turf/turf";
import type { Feature, Geometry } from "geojson";

import { createClient } from "@/lib/supabase/server";
import { nearestNeighborSequence } from "@/lib/sequencing";

function revalidateJob(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/crew`);
}

/**
 * Generates a recommended sequence: zones are ordered by nearest-neighbor
 * distance minimization, then work areas within each zone are ordered the
 * same way. Always a starting recommendation — sequence_order is a plain
 * editable integer, not derived state.
 */
export async function generateSequence(jobId: string) {
  const supabase = await createClient();

  const [{ data: zones, error: zoneError }, { data: workAreas, error: waError }] =
    await Promise.all([
      supabase.from("zones").select("*").eq("job_id", jobId),
      supabase.from("work_areas").select("id, zone_id, geometry").eq("job_id", jobId),
    ]);
  if (zoneError) throw zoneError;
  if (waError) throw waError;
  if (!workAreas || workAreas.length === 0) return;

  const centroidOf = (geometry: Feature<Geometry>) =>
    turf.centroid(geometry).geometry.coordinates as [number, number];

  const workAreasByZone = new Map<string | null, typeof workAreas>();
  for (const wa of workAreas) {
    const key = wa.zone_id ?? null;
    if (!workAreasByZone.has(key)) workAreasByZone.set(key, []);
    workAreasByZone.get(key)!.push(wa);
  }

  const zoneItems = (zones ?? []).map((zone) => {
    const members = workAreasByZone.get(zone.id) ?? [];
    const centroids = members.map((wa) => centroidOf(wa.geometry as Feature<Geometry>));
    const avg: [number, number] =
      centroids.length > 0
        ? [
            centroids.reduce((s, c) => s + c[0], 0) / centroids.length,
            centroids.reduce((s, c) => s + c[1], 0) / centroids.length,
          ]
        : [0, 0];
    return { id: zone.id, centroid: avg };
  });

  const zoneOrder = nearestNeighborSequence(zoneItems);

  await Promise.all(
    zoneOrder.map((zoneId, index) =>
      supabase.from("zones").update({ sequence_order: index }).eq("id", zoneId)
    )
  );

  for (const zoneId of [...zoneOrder, null]) {
    const members = workAreasByZone.get(zoneId) ?? [];
    if (members.length === 0) continue;
    const items = members.map((wa) => ({
      id: wa.id,
      centroid: centroidOf(wa.geometry as Feature<Geometry>),
    }));
    const order = nearestNeighborSequence(items);
    await Promise.all(
      order.map((waId, index) =>
        supabase.from("work_areas").update({ sequence_order: index }).eq("id", waId)
      )
    );
  }

  revalidateJob(jobId);
}

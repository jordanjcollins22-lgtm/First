"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { milesToLatLng } from "@/lib/attractor-geometry";
import type { LatLng } from "@/types/domain";

export interface SaveCanvasDesignInput {
  address: string;
  imagePath: string | null;
  imageX: number;
  imageY: number;
  imageScale: number;
  imageRotation: number;
  imageRealWidthFeet: number | null;
  locked: boolean;
  propertyLine: { x: number; y: number }[];
  zones: unknown[];
}

export async function saveCanvasDesign(jobId: string, input: SaveCanvasDesignInput) {
  const supabase = await createClient();
  const { error } = await supabase.from("canvas_designs").upsert(
    {
      job_id: jobId,
      address: input.address,
      image_path: input.imagePath,
      image_x: input.imageX,
      image_y: input.imageY,
      image_scale: input.imageScale,
      image_rotation: input.imageRotation,
      image_real_width_feet: input.imageRealWidthFeet,
      locked: input.locked,
      property_line: input.propertyLine,
      zones: input.zones,
    },
    { onConflict: "job_id" }
  );
  if (error) throw error;
  revalidatePath(`/jobs/${jobId}`);
}

// Must match CANVAS_WIDTH/CANVAS_HEIGHT in image-canvas-board.tsx — the
// canvas the property line was drawn on. The satellite photo is fetched to
// exactly fill that canvas, centered on the property's geocoded address,
// so canvas-center == the property's real lat/lng and canvas-width ==
// image_real_width_feet feet, regardless of what the boundary itself covers.
const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 625;

/** Looks up any job under this property with a drawn property line and
 * converts its canvas-pixel points into approximate real lat/lng around
 * the property's own location. Rough by nature (the app's own real-width
 * estimate is informational, not survey-grade) — good enough to
 * sanity-check on the map. */
export async function getPropertyLineForProperty(
  propertyId: string,
  center: LatLng
): Promise<LatLng[] | null> {
  const supabase = await createClient();
  const { data: jobs } = await supabase.from("jobs").select("id").eq("property_id", propertyId);
  const jobIds = (jobs ?? []).map((j) => j.id as string);
  if (jobIds.length === 0) return null;

  const { data: designs } = await supabase
    .from("canvas_designs")
    .select("property_line, image_real_width_feet")
    .in("job_id", jobIds);

  const design = (designs ?? []).find(
    (d) => Array.isArray(d.property_line) && (d.property_line as unknown[]).length >= 3 && d.image_real_width_feet
  );
  if (!design) return null;

  const points = design.property_line as { x: number; y: number }[];
  const widthFeet = design.image_real_width_feet as number;
  const feetPerPixel = widthFeet / CANVAS_WIDTH;

  return points.map((p) => {
    const dxFeet = (p.x - CANVAS_WIDTH / 2) * feetPerPixel;
    const dyFeet = (CANVAS_HEIGHT / 2 - p.y) * feetPerPixel; // canvas y is down; north is up
    return milesToLatLng({ x: dxFeet / 5280, y: dyFeet / 5280 }, center);
  });
}

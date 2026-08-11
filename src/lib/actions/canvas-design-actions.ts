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

/** Looks up any job under this property with a drawn property line and
 * converts its canvas-pixel points into approximate real lat/lng around
 * the property's own location, using the drawn line's own pixel width as
 * a stand-in for the image's real-world width (it's typically drawn edge
 * to edge). Rough by nature — good enough to sanity-check on the map. */
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
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const pixelWidth = Math.max(...xs) - Math.min(...xs) || 1;
  const feetPerPixel = widthFeet / pixelWidth;
  const centroidX = xs.reduce((s, x) => s + x, 0) / xs.length;
  const centroidY = ys.reduce((s, y) => s + y, 0) / ys.length;

  return points.map((p) => {
    const dxFeet = (p.x - centroidX) * feetPerPixel;
    const dyFeet = (centroidY - p.y) * feetPerPixel; // canvas y is down; north is up
    return milesToLatLng({ x: dxFeet / 5280, y: dyFeet / 5280 }, center);
  });
}

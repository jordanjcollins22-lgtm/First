"use server";

import { revalidateJobViews } from "@/lib/revalidate-job";

import { createClient } from "@/lib/supabase/server";
import type { CanvasMark } from "@/lib/canvas-marks";

export interface SaveCanvasDesignInput {
  address: string;
  imagePath: string | null;
  imageX: number;
  imageY: number;
  imageScale: number;
  imageRotation: number;
  imageRealWidthFeet: number | null;
  /** Compass degrees at the top of the satellite photo. */
  imageBearing: number;
  /** Whether a person has said the house is the right way round. */
  orientationConfirmed: boolean;
  /** Whether the image was uploaded by the user (vs. fetched from satellite). */
  imageUploaded: boolean;
  locked: boolean;
  propertyLine: { x: number; y: number }[];
  houseOutline: { x: number; y: number }[];
  marks: CanvasMark[];
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
      image_bearing: input.imageBearing,
      orientation_confirmed: input.orientationConfirmed,
      image_uploaded: input.imageUploaded,
      locked: input.locked,
      property_line: input.propertyLine,
      house_outline: input.houseOutline,
      marks: input.marks,
      zones: input.zones,
    },
    { onConflict: "job_id" }
  );
  if (error) throw error;
  revalidateJobViews(jobId);
}

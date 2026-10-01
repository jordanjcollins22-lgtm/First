"use server";

import { revalidateJobViews } from "@/lib/revalidate-job";

import { createClient } from "@/lib/supabase/server";
import type { CanvasMark } from "@/lib/canvas-marks";
import type { ImageGeo } from "@/lib/lot-map";
import { couldLoseGround, isEmptyDesign, keepSavedGround, wouldBlank, type DesignShape, type SavedGround } from "@/lib/design-safety";

/** How many things are in a jsonb column that should hold a list. */
function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

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
  /** Where the satellite photo was taken from, for drawing the county line. Null for an upload. */
  imageGeo?: ImageGeo | null;
  /** Whether a person has said the house is the right way round. */
  orientationConfirmed: boolean;
  /** Whether the image was uploaded by the user (vs. fetched from satellite). */
  imageUploaded: boolean;
  locked: boolean;
  propertyLine: { x: number; y: number }[];
  houseOutline: { x: number; y: number }[];
  marks: CanvasMark[];
  zones: unknown[];
  /** Whether the photo at imagePath is the one on the board. False while it is still loading. */
  photoOnPath?: boolean;
}

/**
 * Saves the board, and refuses to save nothing over something.
 *
 * The board autosaves its state a moment after any change, which is right
 * nearly always and catastrophic in one case: a board mounted with empty state
 * over a job that has a real design writes that emptiness over the work on the
 * next keystroke. It happened to a twenty-three zone commercial site, and the
 * only reason it was recoverable is that somebody had generated a proposal
 * from it first, which is luck rather than a design.
 *
 * The guard is here rather than in the board because it then holds however the
 * empty state arose -- a failed load, a race, a bug not yet found.
 *
 * The extra read only happens when the incoming save is completely empty,
 * which is rare, so an ordinary save still costs one round trip.
 */
export async function saveCanvasDesign(jobId: string, input: SaveCanvasDesignInput) {
  const supabase = await createClient();

  const incoming: DesignShape = {
    imagePath: input.imagePath,
    zoneCount: input.zones.length,
    propertyLinePoints: input.propertyLine.length,
    houseOutlinePoints: input.houseOutline.length,
    markCount: input.marks.length,
  };

  if (isEmptyDesign(incoming)) {
    const { data: stored } = await supabase
      .from("canvas_designs")
      .select("image_path, zones, property_line, house_outline, marks")
      .eq("job_id", jobId)
      .maybeSingle();

    const current = stored
      ? {
          imagePath: stored.image_path,
          zoneCount: countOf(stored.zones),
          propertyLinePoints: countOf(stored.property_line),
          houseOutlinePoints: countOf(stored.house_outline),
          markCount: countOf(stored.marks),
        }
      : null;

    if (wouldBlank(incoming, current)) {
      // Silently, and on purpose. This runs from a debounced autosave that
      // nobody asked for and nobody is watching; the honest signal is that the
      // work is still there when they reload.
      console.warn(`Refused an empty autosave over the existing design for job ${jobId}.`);
      return;
    }
  }

  // A board still loading the saved map sends the photo's defaults and can
  // send no line or house. Those do not go over the real ones (see
  // keepSavedGround); the read only happens when a save could lose something.
  const sent: SavedGround & { photoOnPath?: boolean } = {
    imagePath: input.imagePath,
    imageX: input.imageX,
    imageY: input.imageY,
    imageScale: input.imageScale,
    imageRotation: input.imageRotation,
    imageRealWidthFeet: input.imageRealWidthFeet,
    imageBearing: input.imageBearing,
    imageGeo: input.imageGeo ?? null,
    imageUploaded: input.imageUploaded,
    propertyLine: input.propertyLine,
    houseOutline: input.houseOutline,
    photoOnPath: input.photoOnPath,
  };
  let ground: SavedGround = keepSavedGround(sent, null);
  if (couldLoseGround(sent)) {
    const { data: stored } = await supabase
      .from("canvas_designs")
      .select("image_path, image_x, image_y, image_scale, image_rotation, image_real_width_feet, image_bearing, image_geo, image_uploaded, property_line, house_outline")
      .eq("job_id", jobId)
      .maybeSingle();
    ground = keepSavedGround(
      sent,
      stored
        ? {
            imagePath: stored.image_path,
            imageX: stored.image_x,
            imageY: stored.image_y,
            imageScale: stored.image_scale,
            imageRotation: stored.image_rotation,
            imageRealWidthFeet: stored.image_real_width_feet,
            imageBearing: stored.image_bearing,
            imageGeo: stored.image_geo,
            imageUploaded: stored.image_uploaded,
            propertyLine: Array.isArray(stored.property_line) ? (stored.property_line as { x: number; y: number }[]) : [],
            houseOutline: Array.isArray(stored.house_outline) ? (stored.house_outline as { x: number; y: number }[]) : [],
          }
        : null
    );
  }

  const { error } = await supabase.from("canvas_designs").upsert(
    {
      job_id: jobId,
      address: input.address,
      image_path: ground.imagePath,
      image_x: ground.imageX,
      image_y: ground.imageY,
      image_scale: ground.imageScale,
      image_rotation: ground.imageRotation,
      image_real_width_feet: ground.imageRealWidthFeet,
      image_bearing: ground.imageBearing,
      ...(input.imageGeo !== undefined || ground.imageGeo != null ? { image_geo: ground.imageGeo as never } : {}),
      orientation_confirmed: input.orientationConfirmed,
      image_uploaded: ground.imageUploaded,
      locked: input.locked,
      property_line: ground.propertyLine,
      house_outline: ground.houseOutline,
      marks: input.marks,
      zones: input.zones,
    },
    { onConflict: "job_id" }
  );
  if (error) throw error;
  revalidateJobViews(jobId);
}

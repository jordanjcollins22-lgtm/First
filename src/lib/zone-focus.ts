/**
 * Framing the site map on one work area.
 *
 * The whole-property map answers "where is this job". It does not answer "which
 * bed did you mean", which is the question actually asked in the driveway, and
 * on a phone in sunlight seven outlines on one photo is not an answer.
 *
 * So a zone can be picked out on its own. The map keeps the same picture and
 * moves in on that one shape.
 *
 * Two rules make that readable rather than merely correct, and both exist
 * because the naive version is unusable:
 *
 *  - The frame keeps the board's proportions. A frame cut to the shape of the
 *    zone means the map changes shape every time you pick a different one --
 *    tall and thin for a hedge, wide and short for a driveway -- and the page
 *    jumps about underneath the finger doing the picking.
 *
 *  - The frame has a floor. A zone drawn round a single shrub is a few pixels
 *    across, and framed tightly it fills the screen with four blurred pixels
 *    of a satellite photo that never had that detail in it.
 */

import type { Point } from "@/components/canvas/types";

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FocusOptions {
  /** Breathing room around the shape, in canvas units. */
  padding?: number;
  /**
   * The narrowest the frame may get, as a fraction of the board's longest
   * side. Below this the satellite photo has no more detail to give.
   */
  minSpanFraction?: number;
}

/**
 * The frame to draw when one zone is picked out.
 *
 * Returns the whole board for a zone with no shape, which is what an empty
 * outline deserves: showing everything is a worse answer than showing one
 * thing, and a much better one than showing nothing.
 */
export function focusFrame(
  points: Point[],
  canvasWidth: number,
  canvasHeight: number,
  options: FocusOptions = {}
): Frame {
  const whole = { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
  if (points.length === 0) return whole;

  const padding = options.padding ?? 60;
  const minSpanFraction = options.minSpanFraction ?? 1 / 5;
  const minSpan = Math.max(canvasWidth, canvasHeight) * minSpanFraction;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  // The shape, with room around it.
  let width = Math.max(...xs) - Math.min(...xs) + padding * 2;
  let height = Math.max(...ys) - Math.min(...ys) + padding * 2;

  // The floor, before the aspect ratio, so a tiny zone grows in both
  // directions rather than being stretched into a slot.
  width = Math.max(width, minSpan);
  height = Math.max(height, minSpan);

  // The board's proportions, grown into rather than cropped to, so nothing
  // that was inside the frame falls out of it.
  const boardAspect = canvasWidth / canvasHeight;
  if (width / height > boardAspect) height = width / boardAspect;
  else width = height * boardAspect;

  // A frame bigger than the board is the board.
  if (width >= canvasWidth || height >= canvasHeight) return whole;

  // Centred on the shape, then slid back inside the board. Sliding rather
  // than shrinking: shrinking would undo the proportions just set, and a zone
  // against the edge of the photo is common -- it is where the neighbour's
  // fence is.
  const centreX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centreY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const x = Math.min(Math.max(0, centreX - width / 2), canvasWidth - width);
  const y = Math.min(Math.max(0, centreY - height / 2), canvasHeight - height);

  return { x, y, width, height };
}

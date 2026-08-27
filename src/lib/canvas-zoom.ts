import { coverScale } from "@/lib/canvas-cover";

/**
 * Zooming the photo on the evaluation board.
 *
 * There are two different things called "zoom" here and keeping them apart is
 * most of the work.
 *
 * Scaling the photo is instant and free, and has a floor: below the scale
 * that covers the board at every angle, turning the photo shows white in the
 * corners where the garden should be. So the slider stops there rather than
 * letting somebody drag their way back to the problem.
 *
 * Seeing *more ground* than that is a different request, and no amount of
 * scaling answers it — the photo simply does not contain the neighbour's
 * fence. That one needs a new photo from further out, which is what the map
 * zoom is for.
 */

export interface ZoomBounds {
  /** The smallest scale that still covers the board however it is turned. */
  min: number;
  max: number;
}

/**
 * How far in and out the photo can be scaled.
 *
 * The ceiling is four times the floor. Past that the satellite photo has no
 * more detail to give and the board is showing a handful of very large
 * pixels — but somebody zooming that far is aiming at a corner of the drive,
 * not reading the picture, and a zoom control that stops working reads as
 * broken.
 */
export function zoomBounds(input: {
  imageWidth: number;
  imageHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}): ZoomBounds {
  const min = coverScale(input.imageWidth, input.imageHeight, input.canvasWidth, input.canvasHeight);
  return { min, max: min * 4 };
}

export function clampScale(scale: number, bounds: ZoomBounds): number {
  // Only NaN is nonsense. An infinity still says which way somebody was
  // going, and Math.min/max pin it to that end on their own — treating it as
  // nonsense would snap a hard zoom-in all the way back out.
  if (Number.isNaN(scale)) return bounds.min;
  return Math.min(bounds.max, Math.max(bounds.min, scale));
}

/**
 * The scale as the evaluator reads it, where 100% is the whole photo fitted.
 *
 * The underlying number is a ratio against the image's own pixels and means
 * nothing to anybody — 0.71 is not a thing a person setting up an evaluation
 * has an opinion about.
 */
export function zoomPercent(scale: number, bounds: ZoomBounds): number {
  if (bounds.min <= 0) return 100;
  return Math.round((scale / bounds.min) * 100);
}

// ---------------------------------------------------------------------------
// Pinching
// ---------------------------------------------------------------------------

export interface Point2 {
  x: number;
  y: number;
}

export function distanceBetween(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Where a pinch has got to.
 *
 * Measured against where the fingers started rather than where they were a
 * moment ago. Accumulating frame-to-frame ratios drifts — every rounding
 * error is multiplied into the next one — and a pinch that ends up somewhere
 * the fingers do not say is the kind of bug nobody can reproduce on purpose.
 */
export function pinchScale(input: {
  startScale: number;
  startDistance: number;
  distance: number;
  bounds: ZoomBounds;
}): number {
  if (input.startDistance <= 0 || !Number.isFinite(input.distance)) return input.startScale;
  return clampScale(input.startScale * (input.distance / input.startDistance), input.bounds);
}

// ---------------------------------------------------------------------------
// Fetching a wider photo
// ---------------------------------------------------------------------------

/**
 * Bounds on what to ask the map for.
 *
 * The floor is deliberately far wider than a house needs. A quarter-acre lot
 * is done at the default, but this business also quotes multi-acre properties
 * where the whole boundary has to be on screen before a property line can be
 * drawn round it, and a floor set for the common case is a floor somebody
 * hits on the job they most needed it for.
 *
 * The ceiling is where the satellite imagery runs out of resolution — past it
 * the map returns the same pixels larger, which is what the photo scale does
 * anyway and does instantly.
 */
export const MAP_ZOOM_MIN = 13;
export const MAP_ZOOM_MAX = 20;
/**
 * One press: a full zoom level, which doubles the ground across the board and
 * quadruples the area. A fraction of a level reads as nothing happening, and
 * somebody trying to get a five-acre property on screen should not be tapping
 * eight times to do it.
 */
export const MAP_ZOOM_STEP = 1;

export function stepMapZoom(current: number, steps: number): number {
  const next = current + steps * MAP_ZOOM_STEP;
  return Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, Number(next.toFixed(3))));
}

/** Whether a button should be live, so a dead one is never offered. */
export function canStepMapZoom(current: number, steps: number): boolean {
  return stepMapZoom(current, steps) !== clampMapZoom(current);
}

export function clampMapZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MAP_ZOOM_MIN;
  return Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, zoom));
}

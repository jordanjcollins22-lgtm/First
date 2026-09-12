/**
 * Making the photo big enough to turn.
 *
 * A photo that only just fills the board shows white in the corners the
 * moment it is rotated, and an evaluator drawing a property line into a white
 * triangle is drawing onto nothing. The fix is not to stop them rotating it —
 * it is to fetch enough photo that there is always something under the
 * corners.
 *
 * A rectangle covers a board at every angle when its short side is at least
 * the board's diagonal. That is the whole rule.
 */

/** The longest distance across the board — the worst case for a rotation. */
export function boardDiagonal(canvasWidth: number, canvasHeight: number): number {
  return Math.hypot(canvasWidth, canvasHeight);
}

/**
 * How much to scale a photo so it covers the board at any rotation.
 *
 * Never less than 1: shrinking a photo that already covers would put the
 * corners back.
 */
export function coverScale(
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number
): number {
  const shortSide = Math.min(imageWidth, imageHeight);
  if (shortSide <= 0) return 1;
  return boardDiagonal(canvasWidth, canvasHeight) / shortSide;
}

/**
 * How much to scale a photo so the whole of it is on the board.
 *
 * The opposite request to covering, and the right one for a photo somebody
 * has just uploaded: they picked that image, and the first thing they should
 * see is all of it. Covering a board with an uploaded photo always crops it
 * -- the board's diagonal is longer than either of its sides, so the cover
 * scale is always the larger of the two -- which is how an upload arrived
 * looking fully zoomed in with no way back out.
 */
export function containScale(
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number
): number {
  if (imageWidth <= 0 || imageHeight <= 0) return 1;
  return Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
}

/**
 * Whether a photo drawn at this scale still covers the board once turned.
 *
 * Used by the tests rather than by the app — the app's job is to pick a scale
 * that makes this true, and this is how we know it did.
 */
export function coversAtEveryAngle(
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  scale: number
): boolean {
  const shortSide = Math.min(imageWidth, imageHeight) * scale;
  return shortSide >= boardDiagonal(canvasWidth, canvasHeight) - 1e-9;
}

/**
 * How much less ground the board shows once the photo is scaled up to cover.
 *
 * Scaling up to fill the corners means seeing less of the neighbourhood, so
 * the photo has to be fetched from further out to make up for it. This is the
 * factor to back the zoom off by.
 */
export function zoomAdjustmentFor(cover: number): number {
  return Math.log2(Math.max(cover, 1));
}

/**
 * The real-world span of what the board is actually showing.
 *
 * Not the span of the photo — the span of the part of it you can see. Those
 * two stop being the same number the moment the photo is scaled to cover, and
 * the badge on screen is about what is in front of you.
 */
export function visibleWidthFeet(input: {
  canvasWidth: number;
  /** The photo's width in map pixels, before any scaling. */
  imageMapWidth: number;
  /** What one map pixel is worth on the ground. */
  metresPerMapPixel: number;
  /** How much of the photo's width the board covers, 0-1. */
  drawnWidth: number;
}): number {
  const METRES_TO_FEET = 3.28084;
  const fractionShown = input.canvasWidth / input.drawnWidth;
  return input.imageMapWidth * fractionShown * input.metresPerMapPixel * METRES_TO_FEET;
}

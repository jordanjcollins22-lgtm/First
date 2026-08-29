/**
 * Drawing an area on the site map, on a phone, outdoors.
 *
 * Closing a shape meant tapping the first point again, within twelve pixels
 * of it. On a laptop that is fine. Standing in somebody's driveway with a
 * phone in one hand it is not: the tap lands a few pixels out, and instead of
 * closing the area it adds another point — usually right on top of the first
 * one, so the shape looks closed and is not, and the next tap adds another.
 *
 * Two fixes here, and the button is the important one:
 *
 *  - there is a Close area button, so finishing never depends on hitting a
 *    target at all, and
 *  - a tap that lands on the point just placed is treated as the same tap
 *    rather than a new point, because a finger on a moving phone reports two.
 */

export interface DrawPoint {
  x: number;
  y: number;
}

/** How near the first point a tap has to land to close the shape. Generous:
 * a finger pad is about forty pixels across, and the cost of being wrong is
 * a point that can be undone rather than anything lost. */
export const CLOSE_POINT_RADIUS = 20;

/** Two taps closer together than this are one tap that wobbled. */
export const DUPLICATE_SLOP = 6;

export function distanceBetween(a: DrawPoint, b: DrawPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** An area needs three corners before it is an area. */
export const MIN_POINTS = 3;

export function canClose(points: DrawPoint[]): boolean {
  return points.length >= MIN_POINTS;
}

/** Whether this tap was meant as "that is the shape finished". */
export function shouldClose(points: DrawPoint[], tap: DrawPoint, radius = CLOSE_POINT_RADIUS): boolean {
  if (!canClose(points)) return false;
  return distanceBetween(tap, points[0]) <= radius;
}

/**
 * Whether this tap is the last one again.
 *
 * Only checked against the point just placed. A shape that legitimately comes
 * back near an earlier corner is somebody drawing a narrow strip, and
 * refusing that point would be worse than allowing a stray one.
 */
export function isDuplicateTap(points: DrawPoint[], tap: DrawPoint, slop = DUPLICATE_SLOP): boolean {
  if (points.length === 0) return false;
  return distanceBetween(tap, points[points.length - 1]) <= slop;
}

/** The points after a tap: closed, unchanged, or one longer. */
export function addDrawingPoint<T extends DrawPoint>(points: T[], tap: T): T[] {
  if (isDuplicateTap(points, tap)) return points;
  return [...points, tap];
}

/** What the label on the finish button says. */
export function closeLabel(kind: "zone" | "property-line"): string {
  return kind === "property-line" ? "Close property line" : "Close area";
}

/**
 * The line under the picture while drawing.
 *
 * Leads with the button, because that is the move that always works. The tap
 * target is mentioned second and the keyboard last, since most of this
 * happens on a phone that has neither a keyboard nor a steady hand.
 */
export function drawingHint(kind: "zone" | "property-line", pointCount: number): string {
  const thing = kind === "property-line" ? "property line" : "area";
  if (pointCount === 0) return `Tap each corner of the ${thing}.`;
  if (pointCount < MIN_POINTS) return `${pointCount} of ${MIN_POINTS} corners. Keep tapping.`;
  return `Tap ${closeLabel(kind)} when you are done, or tap your first point again.`;
}

import type { MeasurementKind } from "@/lib/zone-measurement";

/**
 * Areas placed with a tap. The evaluator taps once where the work is, answers
 * the same questions, and the area on the map takes the size those answers
 * give, centred on the dot. Pure, so the sizing is tested without a screen.
 */

type Point = { x: number; y: number };

/** What a dot is before anything is measured: a square about this many feet across. */
export const DOT_FEET = 12;
/** How wide a run (an edge, a line of cracks) is drawn, since it has no width of its own. */
const RUN_FEET = 2;
/** A dot as first dropped is never smaller than this many board pixels across, so it can be seen. */
const DOT_MIN_PX = 30;
/** A measured area is drawn true to size, down to this: the dot on it keeps a tiny one findable. */
const MIN_PX = 6;
/** Nor larger than this fraction of the board, so a typo of 5000 does not swallow the map. */
const MAX_PX = 900;

/**
 * Mapbox's static photos use 512-pixel tiles, so a pixel at zoom 0 is half
 * what the usual 256-tile figure (156543) says. Checked against where the
 * county's lot lands on the same photo (see the test).
 */
const EARTH_METERS_PER_TILE_PIXEL_AT_EQUATOR_Z0 = 78271.51696;
const METRES_TO_FEET = 3.28084;

/**
 * How many feet one pixel of the board is, from where the photo was taken
 * and how it sits on the board. Null when that is not known, as for an
 * uploaded photo, and then a dot stays its default size.
 */
export function feetPerBoardPixel(input: {
  lat: number;
  zoom: number;
  /** The square the photo was asked for, in map pixels. */
  request: number;
  /** The photo's own width in pixels. */
  elementWidth: number;
  /** How far the photo is scaled on the board. */
  scale: number;
}): number | null {
  const { lat, zoom, request, elementWidth, scale } = input;
  if (![lat, zoom, request, elementWidth, scale].every(Number.isFinite) || request <= 0 || elementWidth <= 0 || scale <= 0) return null;
  const metresPerMapPixel = (EARTH_METERS_PER_TILE_PIXEL_AT_EQUATOR_Z0 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  const boardPixelsPerMapPixel = (elementWidth / request) * scale;
  return (metresPerMapPixel * METRES_TO_FEET) / boardPixelsPerMapPixel;
}

function box(center: Point, wide: number, tall: number, min = MIN_PX): Point[] {
  const w = Math.min(MAX_PX, Math.max(min, wide)) / 2;
  const h = Math.min(MAX_PX, Math.max(min, tall)) / 2;
  return [
    { x: center.x - w, y: center.y - h },
    { x: center.x + w, y: center.y - h },
    { x: center.x + w, y: center.y + h },
    { x: center.x - w, y: center.y + h },
  ];
}

/** The area as first dropped, before any answers. */
export function dotShape(center: Point, feetPerPx: number | null): Point[] {
  const side = feetPerPx ? DOT_FEET / feetPerPx : 56;
  return box(center, side, side, DOT_MIN_PX);
}

/**
 * The area once it has been measured, centred on the dot. Length by width
 * is a rectangle, wider than tall the way the evaluator would say it. A run
 * is a thin strip. An area with only its square footage is a square of that
 * size. Anything not measured, or no scale to draw it by, keeps its shape.
 */
export function measuredShape(
  center: Point,
  current: Point[],
  measure: { kind: MeasurementKind | null | undefined; lengthFt: number | null; widthFt: number | null; areaSqFt: number | null },
  feetPerPx: number | null
): Point[] {
  if (!feetPerPx) return current;
  const { kind, lengthFt, widthFt, areaSqFt } = measure;
  const pos = (n: number | null): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

  if (kind === "linear" && pos(lengthFt)) return box(center, lengthFt / feetPerPx, RUN_FEET / feetPerPx);
  if (pos(lengthFt) && pos(widthFt)) {
    const long = Math.max(lengthFt, widthFt);
    const short = Math.min(lengthFt, widthFt);
    return box(center, long / feetPerPx, short / feetPerPx);
  }
  if (pos(areaSqFt)) {
    const side = Math.sqrt(areaSqFt) / feetPerPx;
    return box(center, side, side);
  }
  return current;
}

/**
 * Where a photo sits in its space in a post's picture. A photo fills its
 * space (cover), then is zoomed in, and the part kept is moved to where the
 * work is: x and y are 0 to 100, left to right and top to bottom, of how far
 * the kept window sits across the room the photo has spare.
 */

export interface Crop {
  x: number;
  y: number;
  zoom: number;
}

export const CENTRE: Crop = { x: 50, y: 50, zoom: 1 };
export const MAX_ZOOM = 3;

/** A crop with every number inside its range; the middle when there is none. */
export function tidyCrop(raw: unknown): Crop {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof Crop, unknown>>;
  const num = (v: unknown, lo: number, hi: number, d: number) => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : d;
    return Math.min(hi, Math.max(lo, n));
  };
  return { x: num(r.x, 0, 100, 50), y: num(r.y, 0, 100, 50), zoom: num(r.zoom, 1, MAX_ZOOM, 1) };
}

/**
 * How to cut a photo of width w and height h into a space tw by th: the
 * size to scale it to, then the window to keep.
 */
export function cropBox(w: number, h: number, tw: number, th: number, crop: Crop): { width: number; height: number; left: number; top: number } {
  const c = tidyCrop(crop);
  const scale = Math.max(tw / w, th / h) * c.zoom;
  const width = Math.max(tw, Math.round(w * scale));
  const height = Math.max(th, Math.round(h * scale));
  const left = Math.round(((width - tw) * c.x) / 100);
  const top = Math.round(((height - th) * c.y) / 100);
  return { width, height, left, top };
}

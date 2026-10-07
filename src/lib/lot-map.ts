/**
 * The client's own lot, on a satellite photo, split into the parts they can
 * pick: the front yard, the back yard, the sides, around the house, or the
 * whole property.
 *
 * Three things from Harford County make it: the property line (Cadastral),
 * the house's outline (Building Footprint), and the road the house is
 * numbered on (Centerline, which carries address ranges, so a flag lot down
 * a private lane faces the lane and not whichever street is nearest).
 *
 * The front is the side of the house that faces that road. The back is the
 * other side, the sides are either end, and around the house is a band a few
 * metres wide. Each part is a half-plane drawn clipped to the property line,
 * so there is no polygon clipping to get wrong: the browser clips.
 *
 * Pure: the parsing, the choosing and the drawing are all tested here.
 */

export type LngLat = [number, number];

export interface LotData {
  ring: LngLat[];
  /** The house, from the county's building footprints. Null when none was found. */
  footprint: LngLat[] | null;
  /** The nearest point on the road the house faces. Null when unknown. */
  front: LngLat | null;
  frontRoad: string | null;
  lotSqft: number | null;
  structureSqft: number | null;
}

/* --------------------------------------------------------------- parsing */

type Feature = { attributes?: Record<string, unknown>; geometry?: { rings?: number[][][]; paths?: number[][][] } };

function ringOf(feature: Feature | undefined): LngLat[] | null {
  const ring = feature?.geometry?.rings?.[0];
  if (!ring || ring.length < 4) return null;
  return ring.map((p) => [p[0], p[1]] as LngLat);
}

/** The parcel the house sits on, from a Cadastral point query. */
export function parseParcel(body: unknown): { ring: LngLat[]; lotSqft: number | null; structureSqft: number | null } | null {
  const features = (body as { features?: Feature[] } | null)?.features ?? [];
  const feature = features[0];
  const ring = ringOf(feature);
  if (!ring) return null;
  const a = feature!.attributes ?? {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  const acres = num(a.Shape_Acre);
  return {
    ring,
    lotSqft: num(a["Shape.STArea()"]) ?? (acres ? acres * 43560 : null),
    structureSqft: num(a.ST_SQ_FT),
  };
}

export function pointInRing([x, y]: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function ringArea(ring: LngLat[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(sum / 2);
}

export function centroidOf(ring: LngLat[]): LngLat {
  const pts = ring.slice(0, ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? -1 : undefined);
  const sx = pts.reduce((s, p) => s + p[0], 0);
  const sy = pts.reduce((s, p) => s + p[1], 0);
  return [sx / pts.length, sy / pts.length];
}

/**
 * The house: the footprint under the pin, or failing that the biggest one
 * whose middle is on the lot. Sheds and garages are smaller than houses.
 */
export function pickFootprint(body: unknown, pin: LngLat | null, parcel: LngLat[]): LngLat[] | null {
  const rings = ((body as { features?: Feature[] } | null)?.features ?? []).map(ringOf).filter((r): r is LngLat[] => Boolean(r));
  if (pin) {
    const under = rings.find((r) => pointInRing(pin, r));
    if (under) return under;
  }
  const onLot = rings.filter((r) => pointInRing(centroidOf(r), parcel)).sort((a, b) => ringArea(b) - ringArea(a));
  return onLot[0] ?? null;
}

/** "415 Harrington Road, Bel Air, ..." to 415 and HARRINGTON. */
export function streetOf(address: string): { number: number | null; name: string | null } {
  const first = address.split(",")[0]?.trim() ?? "";
  const match = first.match(/^(\d+)[a-z]?\s+(.+)$/i);
  if (!match) return { number: null, name: null };
  const words = match[2].toUpperCase().replace(/[.]/g, "").split(/\s+/);
  const SUFFIX = /^(ROAD|RD|STREET|ST|LANE|LN|COURT|CT|DRIVE|DR|AVENUE|AVE|PLACE|PL|WAY|CIRCLE|CIR|BOULEVARD|BLVD|TERRACE|TER|TRAIL|TRL|PIKE|HIGHWAY|HWY|PKWY|PARKWAY)$/;
  const core = words.length > 1 && SUFFIX.test(words[words.length - 1]) ? words.slice(0, -1) : words;
  return { number: Number(match[1]), name: core.join(" ") || null };
}

function closestOnSegment(p: LngLat, a: LngLat, b: LngLat, kx: number): LngLat {
  // In locally scaled metres, so a degree of longitude is not a degree of latitude.
  const ax = a[0] * kx, ay = a[1], bx = b[0] * kx, by = b[1], px = p[0] * kx, py = p[1];
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return [(ax + t * dx) / kx, ay + t * dy];
}

function metres(a: LngLat, b: LngLat): number {
  const kx = Math.cos((a[1] * Math.PI) / 180) * 111320;
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110574);
}

/**
 * The point on the road the house faces. First choice is the stretch whose
 * address range holds the house number (a private lane named ALLEY that
 * serves 415 to 419 is the front of 415). Then the named street. Then the
 * nearest road of any name.
 */
export function pickFront(body: unknown, house: LngLat, address: { number: number | null; name: string | null }): { point: LngLat; road: string | null } | null {
  const features = (body as { features?: Feature[] } | null)?.features ?? [];
  const kx = Math.cos((house[1] * Math.PI) / 180);
  type Candidate = { point: LngLat; road: string | null; rank: number; distance: number };
  const candidates: Candidate[] = [];
  for (const feature of features) {
    const a = feature.attributes ?? {};
    const name = String(a.NAME ?? "").trim().toUpperCase();
    const street = String(a.STREETNAME ?? a.RDNAMELOCA ?? "").trim();
    const ranges = [
      [a.FR_ADD_L, a.TO_ADD_L],
      [a.FR_ADD_R, a.TO_ADD_R],
    ].map(([from, to]) => [Number(from), Number(to)]);
    const holdsNumber =
      address.number != null &&
      ranges.some(([from, to]) => Number.isFinite(from) && Number.isFinite(to) && from > 0 && to > 0 && address.number! >= Math.min(from, to) && address.number! <= Math.max(from, to));
    const namedRight = Boolean(address.name) && (name === address.name || name.startsWith(`${address.name} `));
    const rank = holdsNumber && (namedRight || name === "ALLEY" || name === "") ? 0 : holdsNumber ? 1 : namedRight ? 2 : 3;
    for (const path of feature.geometry?.paths ?? []) {
      for (let i = 1; i < path.length; i++) {
        const point = closestOnSegment(house, [path[i - 1][0], path[i - 1][1]], [path[i][0], path[i][1]], kx);
        candidates.push({ point, road: street || name || null, rank, distance: metres(house, point) });
      }
    }
  }
  candidates.sort((x, y) => x.rank - y.rank || x.distance - y.distance);
  const best = candidates[0];
  return best ? { point: best.point, road: best.road } : null;
}

/* ---------------------------------------------------------------- drawing */

export type AreaKey = "front" | "back" | "sides" | "foundation" | "whole";
type Px = [number, number];

export interface LotLayout {
  center: LngLat;
  zoom: number;
  /** Compass degrees at the top of the picture: the street side is at the bottom. */
  bearing: number;
  width: number;
  height: number;
  parcel: Px[];
  house: Px[] | null;
  /** Each pickable part as one or more polygons, to be drawn clipped to the parcel. */
  regions: Record<AreaKey, Px[][]>;
  /** Where to write "Street" on the picture. */
  frontLabel: { at: Px; text: string } | null;
}

const TILE = 512;

function worldPx([lng, lat]: LngLat, zoom: number): Px {
  const scale = TILE * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * scale, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale];
}

function fromWorldPx([x, y]: Px, zoom: number): LngLat {
  const scale = TILE * 2 ** zoom;
  const lng = (x / scale) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180) / Math.PI;
  return [lng, lat];
}

/** Turn a map offset so that `bearing` is at the top, as Mapbox does. */
function turnForBearing([dx, dy]: Px, bearing: number): Px {
  const b = (-bearing * Math.PI) / 180;
  return [dx * Math.cos(b) - dy * Math.sin(b), dx * Math.sin(b) + dy * Math.cos(b)];
}

const normalise = (deg: number) => ((deg % 360) + 360) % 360;

/** Compass degrees from one point to another, on the ground. */
export function compassBearing(from: LngLat, to: LngLat): number {
  const dx = (to[0] - from[0]) * Math.cos((from[1] * Math.PI) / 180) * 111320;
  const dy = (to[1] - from[1]) * 110574;
  return normalise((Math.atan2(dx, dy) * 180) / Math.PI);
}

/**
 * Which way the house's walls run, as a compass angle from 0 to 90. Houses
 * are mostly right angles, so every wall votes for its direction modulo a
 * quarter turn, weighted by its length.
 */
export function houseAxis(footprint: LngLat[]): number | null {
  let sx = 0;
  let sy = 0;
  for (let i = 1; i < footprint.length; i++) {
    const a = footprint[i - 1];
    const b = footprint[i];
    const length = Math.hypot((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180) * 111320, (b[1] - a[1]) * 110574);
    if (length === 0) continue;
    const angle = (compassBearing(a, b) * 4 * Math.PI) / 180;
    sx += length * Math.cos(angle);
    sy += length * Math.sin(angle);
  }
  if (Math.hypot(sx, sy) < 1e-9) return null;
  return normalise((Math.atan2(sy, sx) * 180) / Math.PI / 4) % 90;
}

/**
 * The way the picture is turned: the street side at the bottom, squared to
 * the house's walls so the front of the house sits level. Each turn from
 * "Front's wrong?" moves the front a quarter round.
 */
export function viewBearing(lot: LotData, turn = 0): number {
  const house = lot.footprint ? centroidOf(lot.footprint) : null;
  let front: number | null = null;
  if (lot.front) front = compassBearing(house ?? centroidOf(lot.ring), lot.front);
  else if (house) {
    const middle = centroidOf(lot.ring);
    // No road known: the house usually sits nearer the street than the back fence.
    if (Math.hypot(house[0] - middle[0], house[1] - middle[1]) > 1e-7) front = compassBearing(middle, house);
  }
  if (front == null) return normalise(turn * 90);
  const axis = lot.footprint ? houseAxis(lot.footprint) : null;
  if (axis != null) {
    // The quarter of the house's own walls nearest the street.
    const candidates = [0, 1, 2, 3].map((k) => axis + k * 90);
    const gap = (a: number) => Math.min(normalise(a - front!), normalise(front! - a));
    front = candidates.reduce((best, c) => (gap(c) < gap(best) ? c : best), candidates[0]);
  }
  // The street side down means the opposite way is at the top.
  return normalise(front + 180 + turn * 90);
}

/** The zoom and middle that fit the lot in the picture, turned, with some room round it. */
export function fitView(ring: LngLat[], width: number, height: number, bearing = 0, padding = 0.18): { center: LngLat; zoom: number } {
  const origin = worldPx(centroidOf(ring), 0);
  const turned = ring.map((p) => {
    const w = worldPx(p, 0);
    return turnForBearing([w[0] - origin[0], w[1] - origin[1]], bearing);
  });
  const xs = turned.map((p) => p[0]);
  const ys = turned.map((p) => p[1]);
  const spanX = Math.max(1e-12, Math.max(...xs) - Math.min(...xs));
  const spanY = Math.max(1e-12, Math.max(...ys) - Math.min(...ys));
  // The middle of the turned box, turned back onto the map.
  const mid = turnForBearing([(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2], -bearing);
  const center = fromWorldPx([origin[0] + mid[0], origin[1] + mid[1]], 0);
  const zoom = Math.log2(Math.min((width * (1 - padding * 2)) / spanX, (height * (1 - padding * 2)) / spanY));
  return { center, zoom: Math.min(20, Math.max(15, Math.round(zoom * 100) / 100)) };
}

export function layoutLot(lot: LotData, width: number, height: number, turn = 0): LotLayout {
  const bearing = viewBearing(lot, turn);
  const { center, zoom } = fitView(lot.ring, width, height, bearing);
  const origin = worldPx(center, zoom);
  const px = (p: LngLat): Px => {
    const w = worldPx(p, zoom);
    const t = turnForBearing([w[0] - origin[0], w[1] - origin[1]], bearing);
    return [t[0] + width / 2, t[1] + height / 2];
  };
  const parcel = lot.ring.map(px);
  const house = lot.footprint ? lot.footprint.map(px) : null;
  const metresPerPx = (156543.03392 * Math.cos((center[1] * Math.PI) / 180)) / 2 ** zoom / (TILE / 256);

  // The picture is turned so the street is at the bottom: the front is
  // straight down and the sides are left and right, square to the house.
  const f: Px = [0, 1];
  const l: Px = [-1, 0];
  let houseCentre: Px;
  let fMin: number, fMax: number, lMin: number, lMax: number;
  if (house) {
    const xs = house.map((p) => p[0]);
    const ys = house.map((p) => p[1]);
    houseCentre = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    fMin = Math.min(...ys) - houseCentre[1];
    fMax = Math.max(...ys) - houseCentre[1];
    lMin = -(Math.max(...xs) - houseCentre[0]);
    lMax = -(Math.min(...xs) - houseCentre[0]);
  } else {
    houseCentre = centroidOf(parcel as unknown as LngLat[]) as unknown as Px;
    const sideFt = Math.sqrt(Math.min(4000, Math.max(900, (lot.structureSqft ?? 2000) / 1.5)));
    const half = (sideFt * 0.3048) / 2 / metresPerPx;
    fMin = -half;
    fMax = half;
    lMin = -half;
    lMax = half;
  }
  const D = Math.max(width, height) * 4;
  const band = 3 / metresPerPx; // about 10 feet round the house
  const at = (a: number, b: number): Px => [houseCentre[0] + f[0] * a + l[0] * b, houseCentre[1] + f[1] * a + l[1] * b];
  const quad = (a0: number, a1: number, b0: number, b1: number): Px[] => [at(a0, b0), at(a1, b0), at(a1, b1), at(a0, b1)];

  const regions: Record<AreaKey, Px[][]> = {
    front: [quad(fMax, D, -D, D)],
    back: [quad(-D, fMin, -D, D)],
    sides: [quad(fMin, fMax, lMax, D), quad(fMin, fMax, -D, lMin)],
    foundation: [quad(fMin - band, fMax + band, lMin - band, lMax + band)],
    whole: [parcel],
  };

  // The label sits on the street side, below the house.
  const labelAt = at(fMax + 40, 0);
  return {
    center,
    zoom,
    bearing,
    width,
    height,
    parcel,
    house,
    regions,
    frontLabel: { at: labelAt, text: lot.frontRoad ? "Street side" : "Front" },
  };
}

/** The satellite photo behind it, from Mapbox, turned to the same bearing. */
/** The map's credits, shown under a photo from satelliteUrl. */
export const MAP_CREDIT = "© Mapbox © OpenStreetMap © Maxar";

export function satelliteUrl(layout: Pick<LotLayout, "center" | "zoom" | "bearing" | "width" | "height">, token: string): string {
  const [lng, lat] = layout.center;
  // No logo or credits printed over the photo: the credits are said under it
  // instead (MAP_CREDIT), which is what Mapbox asks for when they are off the image.
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng.toFixed(6)},${lat.toFixed(6)},${layout.zoom},${layout.bearing.toFixed(1)}/${layout.width}x${layout.height}@2x?attribution=false&logo=false&access_token=${token}`;
}

export function pathOf(points: Px[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") + " Z";
}

/* ------------------------------------------------ onto the site map board */

/** Where a site map's satellite photo was taken from. */
export interface ImageGeo {
  lng: number;
  lat: number;
  /** The Mapbox zoom the photo was fetched at. */
  zoom: number;
  /** Compass degrees at the top of the photo. */
  bearing: number;
  /** The square size asked for, in map pixels. */
  request: number;
  /** The height kept after the attribution strip was trimmed, split top and bottom. */
  kept: number;
}

/** How the photo sits on the board: its middle, its scale and its turn. */
export interface BoardImage {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  /** The photo's own width in pixels (a 2x fetch is twice the request). */
  elementWidth: number;
}

/**
 * A point on the ground to a point on the board. The photo's pixels come
 * from the map (Web Mercator at the zoom and bearing it was fetched at), and
 * the board draws the photo moved, scaled and turned; this undoes both, so
 * the county's line stays on the ground whatever the evaluator does to the
 * photo.
 */
export function groundToBoard(point: LngLat, geo: ImageGeo, image: BoardImage): { x: number; y: number } {
  const a = worldPx(point, geo.zoom);
  const c = worldPx([geo.lng, geo.lat], geo.zoom);
  const dx = a[0] - c[0];
  const dy = a[1] - c[1];
  // The map was turned so the bearing is at the top.
  const [mx, my] = turnForBearing([dx, dy], geo.bearing);
  // Map pixels to the photo's pixels, then onto the board.
  const ratio = image.elementWidth / geo.request;
  const ex = mx * ratio * image.scale;
  const ey = my * ratio * image.scale;
  const r = (image.rotation * Math.PI) / 180;
  return { x: image.x + ex * Math.cos(r) - ey * Math.sin(r), y: image.y + ex * Math.sin(r) + ey * Math.cos(r) };
}

/* --------------------------------------------- the parts, on the ground */

/** Clips a polygon to a convex one (Sutherland-Hodgman). */
function clipTo(subject: Px[], clip: Px[]): Px[] {
  // Which way the clip polygon winds, so "inside" is the right side.
  let area = 0;
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const sign = area >= 0 ? 1 : -1;
  let out = subject;
  for (let i = 0; i < clip.length && out.length > 0; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const inside = (p: Px) => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= 0;
    const cross = (p: Px, q: Px): Px => {
      const d1 = [q[0] - p[0], q[1] - p[1]];
      const d2 = [b[0] - a[0], b[1] - a[1]];
      const den = d1[0] * d2[1] - d1[1] * d2[0];
      if (Math.abs(den) < 1e-12) return p;
      const t = ((a[0] - p[0]) * d2[1] - (a[1] - p[1]) * d2[0]) / den;
      return [p[0] + t * d1[0], p[1] + t * d1[1]];
    };
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      if (inside(q)) {
        if (!inside(p)) out.push(cross(p, q));
        out.push(q);
      } else if (inside(p)) {
        out.push(cross(p, q));
      }
    }
  }
  return out;
}

/**
 * Each part of the yard the form offers (front, back, sides, around the
 * house, the whole lot) as outlines on the ground, cut to the property
 * line. The same parts the client picked on the form, so the site map can
 * start with them drawn where the client meant.
 */
export function groundRegions(lot: LotData, turn = 0): Record<AreaKey, LngLat[][]> {
  const width = 640;
  const height = 440;
  const layout = layoutLot(lot, width, height, turn);
  const origin = worldPx(layout.center, layout.zoom);
  const toGround = ([x, y]: Px): LngLat => {
    const back = turnForBearing([x - width / 2, y - height / 2], -layout.bearing);
    return fromWorldPx([back[0] + origin[0], back[1] + origin[1]], layout.zoom);
  };
  // An open ring, for clipping.
  const parcel = layout.parcel.slice(0, layout.parcel.length > 1 && layout.parcel[0][0] === layout.parcel[layout.parcel.length - 1][0] && layout.parcel[0][1] === layout.parcel[layout.parcel.length - 1][1] ? -1 : undefined);
  const out = {} as Record<AreaKey, LngLat[][]>;
  for (const key of Object.keys(layout.regions) as AreaKey[]) {
    out[key] =
      key === "whole"
        ? [lot.ring]
        : layout.regions[key].map((quad) => clipTo(parcel, quad)).filter((ring) => ring.length >= 3).map((ring) => ring.map(toGround));
  }
  return out;
}

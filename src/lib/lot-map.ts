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

/** The zoom and middle that fit the lot in the picture with some room round it. */
export function fitView(ring: LngLat[], width: number, height: number, padding = 0.18): { center: LngLat; zoom: number } {
  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const center: LngLat = [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
  const a = worldPx([Math.min(...lngs), Math.max(...lats)], 0);
  const b = worldPx([Math.max(...lngs), Math.min(...lats)], 0);
  const spanX = Math.max(1e-9, b[0] - a[0]);
  const spanY = Math.max(1e-9, b[1] - a[1]);
  const zoom = Math.log2(Math.min((width * (1 - padding * 2)) / spanX, (height * (1 - padding * 2)) / spanY));
  return { center, zoom: Math.min(20, Math.max(15, Math.round(zoom * 100) / 100)) };
}

export function layoutLot(lot: LotData, width: number, height: number, turn = 0): LotLayout {
  const { center, zoom } = fitView(lot.ring, width, height);
  const origin = worldPx(center, zoom);
  const px = (p: LngLat): Px => {
    const w = worldPx(p, zoom);
    return [w[0] - origin[0] + width / 2, w[1] - origin[1] + height / 2];
  };
  const parcel = lot.ring.map(px);
  const house = lot.footprint ? lot.footprint.map(px) : null;
  const metresPerPx = (156543.03392 * Math.cos((center[1] * Math.PI) / 180)) / 2 ** zoom / (TILE / 256);

  const houseCentre: Px = house ? (centroidOf(house as unknown as LngLat[]) as unknown as Px) : (centroidOf(parcel as unknown as LngLat[]) as unknown as Px);

  // Towards the street. With no road known, the side of the lot the house
  // is nearest the edge of is the best guess there is: towards the parcel's
  // middle is the back.
  let f: Px;
  if (lot.front) {
    const p = px(lot.front);
    f = [p[0] - houseCentre[0], p[1] - houseCentre[1]];
  } else {
    const c = centroidOf(parcel as unknown as LngLat[]);
    f = [houseCentre[0] - c[0], houseCentre[1] - c[1]];
    if (Math.hypot(f[0], f[1]) < 1) f = [0, 1];
  }
  const len = Math.hypot(f[0], f[1]) || 1;
  f = [f[0] / len, f[1] / len];
  for (let i = 0; i < ((turn % 4) + 4) % 4; i++) f = [-f[1], f[0]];
  const l: Px = [-f[1], f[0]];

  // How far the house reaches along each axis, from its middle.
  const extent = (points: Px[], axis: Px) => points.map((p) => (p[0] - houseCentre[0]) * axis[0] + (p[1] - houseCentre[1]) * axis[1]);
  let fs: number[], ls: number[];
  if (house) {
    fs = extent(house, f);
    ls = extent(house, l);
  } else {
    const sideFt = Math.sqrt(Math.min(4000, Math.max(900, (lot.structureSqft ?? 2000) / 1.5)));
    const half = (sideFt * 0.3048) / 2 / metresPerPx;
    fs = [-half, half];
    ls = [-half, half];
  }
  const fMin = Math.min(...fs), fMax = Math.max(...fs), lMin = Math.min(...ls), lMax = Math.max(...ls);
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

  // The label sits just inside the lot on the street side.
  const labelAt = at(fMax + Math.min(40, D), 0);
  return {
    center,
    zoom,
    width,
    height,
    parcel,
    house,
    regions,
    frontLabel: { at: labelAt, text: lot.frontRoad ? "Street side" : "Front" },
  };
}

/** The satellite photo behind it, from Mapbox, north up. */
export function satelliteUrl(layout: Pick<LotLayout, "center" | "zoom" | "width" | "height">, token: string): string {
  const [lng, lat] = layout.center;
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng.toFixed(6)},${lat.toFixed(6)},${layout.zoom},0/${layout.width}x${layout.height}@2x?access_token=${token}`;
}

export function pathOf(points: Px[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") + " Z";
}

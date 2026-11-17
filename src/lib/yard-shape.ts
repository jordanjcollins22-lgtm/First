/**
 * A home's own yard, where the county has no line round it.
 *
 * Two kinds of place have no per-home lot line in Harford's records:
 *
 *  - Townhouse and condo communities where each home's "lot" is the house
 *    itself, and the grass round it is the HOA's common land.
 *  - Rental communities where the whole block, every house on it, is one lot
 *    owned by one company.
 *
 * In both, the yard is worked out from what the county does have: the
 * buildings, and which land is common. It reaches halfway to the next home,
 * stops at the street (roads are not lots) and at anybody else's lot, and goes
 * no further than a small yard would. A townhouse row is cut into its homes
 * first, so the yard is the client's own end of it, not the whole row's.
 *
 * Pure and in local metres, so it is tested without the county.
 */

import { houseAxis, pointInRing, type LngLat } from "@/lib/lot-map";

type Xy = [number, number];

/** How far the yard reaches past the back of the home. About 26 feet. */
export const BACK_M = 8;
/** How far past the front, at most. The sidewalk or the street stops it sooner on most homes. About 50 feet. */
export const FRONT_M = 15;
/** How far past an open side, on an end home. About 16 feet. */
export const SIDE_M = 5;
/** A yard stops this far from a road's centerline: the curb and the sidewalk. About 20 feet. */
export const STREET_M = 6;
/** How close two homes' claims can be and still count as a tie, in metres. */
const TIE_M = 0.6;
/** A townhouse is usually 18 to 24 feet wide; this is the middle of that. */
export const TOWNHOUSE_WIDTH_M = 6.5;

export interface YardInput {
  /** Where the client's home is: the address pin. */
  pin: LngLat;
  /** The home: its own lot where the county has one, or the building it's in. */
  home: LngLat[];
  /** Cut a long building into townhouses and keep the pin's one. Off when `home` is already just this home. */
  splitRow?: boolean;
  /** Other homes next door: their lots, or their buildings. */
  neighbours: LngLat[][];
  /** Land the yard may be on: the home's own lot and the common land round it. */
  allowed: LngLat[][];
  /** The point on the road the home faces, when known: that end gets the front yard. */
  front?: LngLat | null;
  /** Road centerlines nearby: the yard stops at the sidewalk. */
  streets?: LngLat[][];
  /**
   * Every lot nearby, when known. Ground on none of them is the road's own
   * strip (the grass between a lot line and the sidewalk), and the yard may
   * take it in up to the sidewalk.
   */
  parcels?: LngLat[][];
  /** The county's outlines of sidewalks, when it sent them: the yard stops at the sidewalk. */
  pavement?: LngLat[][] | null;
}

function frame(origin: LngLat) {
  const kx = Math.cos((origin[1] * Math.PI) / 180) * 111320;
  const ky = 110574;
  return {
    to: ([lng, lat]: LngLat): Xy => [(lng - origin[0]) * kx, (lat - origin[1]) * ky],
    from: ([x, y]: Xy): LngLat => [origin[0] + x / kx, origin[1] + y / ky],
  };
}

function inside(p: Xy, ring: Xy[]): boolean {
  return pointInRing(p as unknown as LngLat, ring as unknown as LngLat[]);
}

function segmentDistance(p: Xy, a: Xy, b: Xy): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Metres from a point to a shape: 0 inside it. */
function distanceTo(p: Xy, ring: Xy[]): number {
  if (inside(p, ring)) return 0;
  let best = Infinity;
  for (let i = 1; i < ring.length; i++) best = Math.min(best, segmentDistance(p, ring[i - 1], ring[i]));
  return best;
}

/**
 * A townhouse row cut into its homes, and which one is the client's: the one
 * the pin is nearest along the row. A building that isn't a row comes back
 * whole.
 */
export function homesInBuilding(building: Xy[], pin: Xy, axisDegrees: number | null): { mine: Xy[]; rest: Xy[][] } {
  if (axisDegrees == null) return { mine: building, rest: [] };
  // The two directions the walls run, as unit vectors (compass: 0 is north).
  const rad = (axisDegrees * Math.PI) / 180;
  const a: Xy = [Math.sin(rad), Math.cos(rad)];
  const b: Xy = [Math.cos(rad), -Math.sin(rad)];
  const along = (p: Xy, d: Xy) => p[0] * d[0] + p[1] * d[1];
  const spanOf = (d: Xy) => {
    const v = building.map((p) => along(p, d));
    return { min: Math.min(...v), max: Math.max(...v) };
  };
  const sa = spanOf(a);
  const sb = spanOf(b);
  // The long side is the row.
  const [u, v, su, sv] = sa.max - sa.min >= sb.max - sb.min ? [a, b, sa, sb] : [b, a, sb, sa];
  const length = su.max - su.min;
  const depth = sv.max - sv.min;
  const homes = Math.round(length / TOWNHOUSE_WIDTH_M);
  // A single house, or a building too squat to be a row of homes.
  if (homes < 2 || length < depth * 1.5) return { mine: building, rest: [] };
  const width = length / homes;
  const at = (s: number, t: number): Xy => [u[0] * s + v[0] * t, u[1] * s + v[1] * t];
  const rect = (k: number): Xy[] => {
    const s0 = su.min + k * width;
    const s1 = s0 + width;
    return [at(s0, sv.min), at(s1, sv.min), at(s1, sv.max), at(s0, sv.max), at(s0, sv.min)];
  };
  const k = Math.max(0, Math.min(homes - 1, Math.floor((along(pin, u) - su.min) / width)));
  return { mine: rect(k), rest: Array.from({ length: homes }, (_, i) => i).filter((i) => i !== k).map(rect) };
}

/**
 * The yard, as a ring on the ground: a rectangle squared to the home's own
 * walls. It starts as the home and grows out the back, the front and any
 * open side (an end home's), a little at a time, and each side stops before
 * it would take in another home, another home's lot, land that isn't common
 * (a street, somebody else's lot), or ground nearer the next home than this
 * one. Walls shared with the next townhouse don't grow at all. Straight
 * edges, so it reads as a lot line, not a blob.
 */
export function yardAround(input: YardInput): LngLat[] | null {
  const { to, from } = frame(input.pin);
  const pin = to(input.pin);
  const axis = houseAxis(input.home);
  const split = input.splitRow === false ? { mine: input.home.map(to), rest: [] as Xy[][] } : homesInBuilding(input.home.map(to), pin, axis);
  const mine = split.mine;
  if (mine.length < 4) return null;
  const neighbours = [...split.rest, ...input.neighbours.map((r) => r.map(to))];
  const allowed = input.allowed.map((r) => r.map(to));
  const streets = (input.streets ?? []).map((r) => r.map(to));
  const parcels = input.parcels?.map((r) => r.map(to));
  const roadStrip = (p: Xy) => parcels != null && streets.length > 0 && !parcels.some((ring) => inside(p, ring));
  const pavement = input.pavement?.map((r) => r.map(to)) ?? null;
  // Even-odd: a sidewalk network comes as an outer ring with the blocks it goes round as holes.
  const onPavement = (p: Xy) => (pavement ?? []).filter((ring) => inside(p, ring)).length % 2 === 1;
  // Where the county has no sidewalk here, a set distance from the road's centerline stands in for one.
  const nearStreet = (p: Xy) =>
    (pavement == null || pavement.length === 0) &&
    streets.some((line) => line.some((q, i) => i > 0 && segmentDistance(p, line[i - 1], q) < STREET_M));

  // The home's two wall directions; u runs front to back (the longer way for a townhouse).
  const rad = ((axis ?? 0) * Math.PI) / 180;
  const d1: Xy = [Math.sin(rad), Math.cos(rad)];
  const d2: Xy = [Math.cos(rad), -Math.sin(rad)];
  const dot = (p: Xy, d: Xy) => p[0] * d[0] + p[1] * d[1];
  const span = (d: Xy) => {
    const v = mine.map((p) => dot(p, d));
    return [Math.min(...v), Math.max(...v)] as [number, number];
  };
  const s1 = span(d1);
  const s2 = span(d2);
  const [u, v, su, sv] = s1[1] - s1[0] >= s2[1] - s2[0] ? [d1, d2, s1, s2] : [d2, d1, s2, s1];
  const at = (a: number, b: number): Xy => [u[0] * a + v[0] * b, u[1] * a + v[1] * b];

  // Homes right against this one: the rest of its row. Their walls carry on
  // as the yard's sides, so the yard only stops where it would run into one;
  // a row is often staggered, and ground beside a neighbour's deeper end is
  // still this home's own strip. Every other home splits the ground halfway.
  const rowMates = neighbours.filter((n) => mine.some((p) => distanceTo(p, n) < TIE_M));
  const others = neighbours.filter((n) => !rowMates.includes(n));
  const ok = (p: Xy): boolean => {
    if (inside(p, mine)) return true;
    if (!allowed.some((ring) => inside(p, ring)) && !roadStrip(p)) return false;
    if (nearStreet(p)) return false;
    if (rowMates.some((n) => inside(p, n))) return false;
    const mineD = distanceTo(p, mine);
    // Clearly nearer another home. Ground level with a shared wall is a tie, and stays in.
    return !others.some((n) => distanceTo(p, n) < mineD - TIE_M);
  };

  // Which end is the front: the one nearer the road it faces.
  const frontAtMax = input.front ? dot(to(input.front), u) > (su[0] + su[1]) / 2 : null;
  // A side is shared when another home is right against it.
  const shared = (b: number, out: number) =>
    [0.25, 0.5, 0.75].some((f) => {
      const p = at(su[0] + (su[1] - su[0]) * f, b + out);
      return neighbours.some((n) => distanceTo(p, n) < 0.6);
    });

  const box = { u0: su[0], u1: su[1], v0: sv[0], v1: sv[1] };
  const STEP = 0.5;
  // Checked a little in from each end: lots are drawn by hand and their
  // corners overlap the next one's by a hair.
  // A sidewalk running along the edge covers most of it; a front walk
  // crossing it covers only a little, and the lawn carries on beside it.
  const clean = (strip: (t: number) => Xy, length: number) => {
    let points = 0;
    let paved = 0;
    for (let t = TIE_M; t <= length - TIE_M + 1e-9; t += STEP) {
      const p = strip(t);
      if (!ok(p)) return false;
      points++;
      if (onPavement(p)) paved++;
    }
    return paved * 2 < points;
  };
  const grow = (side: "u0" | "u1" | "v0" | "v1", limit: number) => {
    for (let e = STEP; e <= limit + 1e-9; e += STEP) {
      if (side === "u0" || side === "u1") {
        const a = side === "u0" ? su[0] - e : su[1] + e;
        if (!clean((t) => at(a, box.v0 + t), box.v1 - box.v0)) return;
        box[side] = a;
      } else {
        const b = side === "v0" ? sv[0] - e : sv[1] + e;
        if (!clean((t) => at(box.u0 + t, b), box.u1 - box.u0)) return;
        box[side] = b;
      }
    }
  };
  grow("u1", frontAtMax === true ? FRONT_M : frontAtMax === false ? BACK_M : (FRONT_M + BACK_M) / 2);
  grow("u0", frontAtMax === false ? FRONT_M : frontAtMax === true ? BACK_M : (FRONT_M + BACK_M) / 2);
  if (!shared(sv[0], -0.4)) grow("v0", SIDE_M);
  if (!shared(sv[1], 0.4)) grow("v1", SIDE_M);

  const ring = [at(box.u0, box.v0), at(box.u1, box.v0), at(box.u1, box.v1), at(box.u0, box.v1), at(box.u0, box.v0)];
  return ring.map(from);
}

/** A ring's area in square feet. */
export function ringSqft(ring: LngLat[]): number {
  if (ring.length < 3) return 0;
  const { to } = frame(ring[0]);
  const xy = ring.map(to);
  let sum = 0;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) sum += (xy[j][0] + xy[i][0]) * (xy[j][1] - xy[i][1]);
  return Math.abs(sum / 2) * 10.7639;
}

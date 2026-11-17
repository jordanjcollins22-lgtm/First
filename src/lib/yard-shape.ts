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

/** How far a yard reaches from the house, at most. About 50 feet. */
export const YARD_REACH_M = 15;
/** A townhouse is usually 18 to 24 feet wide; this is the middle of that. */
export const TOWNHOUSE_WIDTH_M = 6.5;

export interface YardInput {
  /** Where the client's home is: the address pin. */
  pin: LngLat;
  /** The building the home is in: a house, or a whole townhouse row. */
  building: LngLat[];
  /** Every other building nearby. */
  others: LngLat[][];
  /** Land the yard may be on: the home's own lot and the common land round it. */
  allowed: LngLat[][];
  reachMetres?: number;
  /** Cut a long building into townhouses and keep the pin's one. Off when the building is already just this home. */
  splitRow?: boolean;
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

/** Metres from a point to a building: 0 inside it. */
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
 * The yard, as a ring on the ground. Rays go out from the home in every
 * direction and stop at the first point that is past the reach, nearer
 * another home than this one, inside another building, or off the land the
 * yard may be on. Null when there is too little to draw.
 */
export function yardAround(input: YardInput): LngLat[] | null {
  const reach = input.reachMetres ?? YARD_REACH_M;
  const { to, from } = frame(input.pin);
  const building = input.building.map(to);
  const pin = to(input.pin);
  const { mine, rest } = input.splitRow === false ? { mine: building, rest: [] } : homesInBuilding(building, pin, houseAxis(input.building));
  const others = [...rest, ...input.others.map((r) => r.map(to))];
  const allowed = input.allowed.map((r) => r.map(to));
  const centre: Xy = [
    mine.slice(0, -1).reduce((s, p) => s + p[0], 0) / (mine.length - 1),
    mine.slice(0, -1).reduce((s, p) => s + p[1], 0) / (mine.length - 1),
  ];

  const ok = (p: Xy): boolean => {
    const d = distanceTo(p, mine);
    if (d === 0) return true;
    if (d > reach) return false;
    if (!allowed.some((ring) => inside(p, ring))) return false;
    for (const other of others) if (distanceTo(p, other) < d) return false;
    return true;
  };

  const RAYS = 96;
  const STEP = 0.5;
  const MAX = 80;
  const ring: Xy[] = [];
  for (let i = 0; i < RAYS; i++) {
    const angle = (i / RAYS) * 2 * Math.PI;
    const dir: Xy = [Math.cos(angle), Math.sin(angle)];
    let last: Xy = centre;
    for (let s = STEP; s <= MAX; s += STEP) {
      const p: Xy = [centre[0] + dir[0] * s, centre[1] + dir[1] * s];
      if (!ok(p)) break;
      last = p;
    }
    ring.push(last);
  }
  if (ring.length < 3) return null;
  ring.push(ring[0]);
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

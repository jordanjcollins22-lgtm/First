/**
 * One USPS route at a time, one question at a time.
 *
 * Flyers and door hangers go out round the jobs we have done and been paid
 * for: the neighbours watched the work happen, and the yard says what we
 * can do. So each carrier route with a paid, finished job on it is put to
 * the owner as a short sequence, and the sequence never shows two things at
 * once: approve the route for mail, draw the door hanger round over it,
 * confirm the hangers, submit the lot for printing. Evaluations and jobs
 * still owed on never make it here.
 *
 * Nothing here reads or writes. It orders, picks and words.
 */

import { orderAlongLine, type Point } from "@/lib/route-order";

export type RouteStep = "usps" | "draw" | "hangers" | "submit";
export type RouteOrderStatus = RouteStep | "ordered" | "skipped";

export const STEP_ORDER: RouteStep[] = ["usps", "draw", "hangers", "submit"];

export const STEP_LABEL: Record<RouteStep, string> = {
  usps: "Approve the USPS route",
  draw: "Draw the door hanger route",
  hangers: "Confirm the door hangers",
  submit: "Submit and print the order",
};

/** The one question each step asks. */
export function stepQuestion(step: RouteStep, facts: { routeId: string; zip: string; pieces: number; doors: number }): string {
  switch (step) {
    case "usps":
      return `Approve USPS route ${facts.routeId} in ${facts.zip} for ${facts.pieces.toLocaleString()} mailers?`;
    case "draw":
      return "Draw the area to hang in, mark where the van parks and where the walk starts and ends, and draw the walking line.";
    case "hangers":
      return `Hang ${facts.doors} door hangers on that round?`;
    case "submit":
      return "Pick the days and submit. The order prints with everything on it.";
  }
}

/** What a job has to show before its street gets a route: nothing owed. */
export interface PaidFacts {
  /** Everything the client has paid, net of card fees. */
  collectedCents: number;
  /** The accepted price, before the discount. Null when no proposal was accepted. */
  priceCents: number | null;
  discountCents: number;
  /** Set when the app itself took the payment in full. */
  paidAt: string | null;
}

/**
 * Paid in full: the app took the money, or what came in covers the price
 * after the discount. A job with no accepted price counts only when
 * something was paid, so a test job at $0 does not get a mailing.
 */
export function paidInFull(facts: PaidFacts): boolean {
  if (facts.paidAt) return true;
  const owed = facts.priceCents == null ? 1 : Math.max(facts.priceCents - facts.discountCents, 1);
  return facts.collectedCents >= owed;
}

export interface RouteCandidate {
  eddmRouteId: string;
  /** When the first job on it was paid. Oldest goes first. */
  since: string;
  houseIds: string[];
}

/**
 * Which route to ask about.
 *
 * The one that has been waiting longest, unless a route is already part
 * way through, in which case that one, because a half-drawn round left on
 * the table is the worst place to leave it.
 */
export function pickRoute<T extends RouteCandidate & { status?: RouteOrderStatus | null }>(candidates: T[]): T | null {
  const open = candidates.filter((c) => c.status !== "ordered" && c.status !== "skipped");
  if (open.length === 0) return null;
  const inFlight = open.find((c) => c.status && c.status !== "usps");
  if (inFlight) return inFlight;
  return [...open].sort((a, b) => a.since.localeCompare(b.since))[0] ?? null;
}

export interface RouteHouse extends Point {
  id: string;
  address: string;
}

/** How far a door may stand from the line and still be on the walk. */
export const DOOR_SNAP_METRES = 45;

/**
 * The doors along the lines drawn, in walking order.
 *
 * Several lines are one walk in the order they were drawn. A house within
 * reach of more than one line lands on the first that reaches it.
 */
export function doorsAlongLines(houses: RouteHouse[], lines: Point[][], snapMetres = DOOR_SNAP_METRES): { order: string[]; line: Point[] } {
  const order: string[] = [];
  const taken = new Set<string>();
  const joined: Point[] = [];
  for (const line of lines) {
    if (line.length < 2) continue;
    const left = houses.filter((h) => !taken.has(h.id));
    const along = orderAlongLine(left, line, snapMetres);
    for (const id of along.ordered) {
      taken.add(id);
      order.push(id);
    }
    joined.push(...line);
  }
  return { order, line: joined };
}

/**
 * Everything a person draws for one walk.
 *
 * The area is what gets hung: every door inside it. The parking spots,
 * the start and the end are where the crew leaves the van and where the
 * walk begins and finishes. The line is how the walk was actually done,
 * drawn so the order of the doors follows it; without one, the doors are
 * ordered nearest-next from the start.
 */
export interface WalkShape {
  area: Point[] | null;
  line: Point[] | null;
  parks: Point[];
  start: Point | null;
  end: Point | null;
}

export const EMPTY_SHAPE: WalkShape = { area: null, line: null, parks: [], start: null, end: null };

/** Inside a polygon, by the even-odd rule. On the edge counts as in. */
export function pointInArea(p: Point, area: Point[]): boolean {
  if (area.length < 3) return false;
  let inside = false;
  for (let i = 0, j = area.length - 1; i < area.length; j = i++) {
    const a = area[i];
    const b = area[j];
    const crosses = a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function doorsInArea<T extends Point>(houses: T[], area: Point[]): T[] {
  return houses.filter((h) => pointInArea(h, area));
}

function metresBetween(a: Point, b: Point): number {
  const k = Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lat - b.lat) * 111_320, (a.lng - b.lng) * 111_320 * k);
}

/** How far along a polyline a point falls, in metres from its start, by its nearest segment. */
export function alongParam(p: Point, line: Point[]): number {
  let best = Infinity;
  let at = 0;
  let sofar = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    const k = Math.cos((a.lat * Math.PI) / 180);
    const ax = a.lng * k, ay = a.lat, bx = b.lng * k, by = b.lat, px = p.lng * k, py = p.lat;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const qx = ax + t * dx, qy = ay + t * dy;
    const d = Math.hypot((px - qx) * 111_320, (py - qy) * 111_320);
    const seg = metresBetween(a, b);
    if (d < best) {
      best = d;
      at = sofar + t * seg;
    }
    sofar += seg;
  }
  return at;
}

/**
 * The doors of a walk, in the order they are walked.
 *
 * With a line, in the order they fall along it. Without one, nearest-next
 * from the start (or the first parking spot, or the first door), which is
 * what a person does on a street anyway.
 */
export function orderDoors<T extends RouteHouse>(doors: T[], shape: Pick<WalkShape, "line" | "start" | "parks">): T[] {
  if (doors.length === 0) return [];
  if (shape.line && shape.line.length > 1) {
    const line = shape.line;
    return [...doors].sort((a, b) => alongParam(a, line) - alongParam(b, line));
  }
  const from = shape.start ?? shape.parks[0] ?? doors[0];
  const left = new Set(doors);
  const out: T[] = [];
  let here: Point = from;
  while (left.size > 0) {
    let next: T | null = null;
    let best = Infinity;
    for (const d of left) {
      const m = metresBetween(here, d);
      if (m < best) {
        best = m;
        next = d;
      }
    }
    if (!next) break;
    left.delete(next);
    out.push(next);
    here = next;
  }
  return out;
}

/**
 * What the drawing amounts to: the doors on the walk, in order.
 *
 * An area takes every door inside it. With no area, the line alone takes
 * the doors within reach of it, as before.
 */
export function walkDoors(houses: RouteHouse[], shape: WalkShape): { order: string[] } {
  if (shape.area && shape.area.length >= 3) {
    return { order: orderDoors(doorsInArea(houses, shape.area), shape).map((h) => h.id) };
  }
  if (shape.line && shape.line.length > 1) return { order: doorsAlongLines(houses, [shape.line]).order };
  return { order: [] };
}

/** "Route C029 in 21014", the way the list and the order name it. */
export function routeName(route: { routeId: string; zip: string }): string {
  return `Route ${route.routeId} in ${route.zip}`;
}

/** The next Monday on or after a day, as YYYY-MM-DD, for a default walk date. */
export function nextMonday(from: Date): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const day = d.getUTCDay();
  const add = day === 1 ? 7 : (8 - day) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

export function plusDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

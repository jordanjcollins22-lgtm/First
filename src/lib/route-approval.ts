/**
 * One USPS route at a time, one question at a time.
 *
 * Every evaluation we do sits on a carrier route, and that route is the
 * natural place to mail and to walk: the neighbours have just watched a van
 * turn up. So each route with an evaluated house on it is put to the owner
 * as a short sequence, and the sequence never shows two things at once:
 * approve the route for mail, draw the door hanger round over it, confirm
 * the hangers, submit the lot for printing.
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
      return "Draw the door hanger route over the top of it. Tap along the streets to walk; the doors fall along the line.";
    case "hangers":
      return `Hang ${facts.doors} door hangers along that line?`;
    case "submit":
      return "Pick the days and submit. The order prints with everything on it.";
  }
}

export interface RouteCandidate {
  eddmRouteId: string;
  /** When the first evaluation on it happened. Oldest goes first. */
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

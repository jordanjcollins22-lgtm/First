/**
 * The sheet handed to whoever walks a route.
 *
 * Modelled on the one the business already makes by hand: a boundary not to
 * leave, a line to follow through the streets, where to park, where to start,
 * where it ends, and the starting address in text for typing into a phone.
 *
 * The point of encoding it is that a half-made sheet is worse than none. Somebody
 * is standing in a van with a stack of hangers; a zone with a boundary and no
 * path is a person guessing which loop to do first, and a zone with a path and
 * no start is a person guessing which end to begin at. So a zone is either
 * ready to walk or it says exactly what it is missing, and nothing in between
 * gets printed.
 */

import { metresBetween, type LngLat } from "@/lib/navigation";

const METRES_PER_MILE = 1609.344;

export interface WalkableZone {
  name: string;
  /** Walking order within the route. */
  position: number;
  /** Typed into a phone in a van, so text and not only a point. */
  startAddress: string | null;
  /** The outline not to leave. */
  boundary: LngLat[] | null;
  /** The streets, in the order to walk them. */
  walkPath: LngLat[] | null;
  startPoint: LngLat | null;
  /** Where the van goes. Rarely the first door. */
  parkPoint: LngLat | null;
  endPoint: LngLat | null;
  houseCount: number;
}

/**
 * Standing instructions, in one place rather than retyped onto every sheet.
 *
 * Both of these are the business's own words and both exist because somebody
 * did the opposite once.
 */
export const WALK_INSTRUCTIONS = [
  "Follow the red line shown in the image. Do not leave the yellow outline.",
  "Start tracking before the first house, and stop only after the final zone.",
] as const;

/**
 * What this zone still needs before somebody can be sent to walk it.
 *
 * Named rather than counted: "not ready" sends whoever is fixing it looking
 * through five fields, and the answer is nearly always one of them.
 */
export function missingForWalk(zone: WalkableZone): string[] {
  const missing: string[] = [];

  if (!zone.boundary || zone.boundary.length < 3) missing.push("a boundary to stay inside");
  if (!zone.walkPath || zone.walkPath.length < 2) missing.push("a path to follow");
  if (!zone.startPoint) missing.push("a starting point");
  if (!zone.startAddress?.trim()) missing.push("a starting address");
  // Parking and the end point are deliberately not required. A dense street
  // has nowhere particular to park, and a loop ends where it started; refusing
  // to print over either would block a sheet that is perfectly walkable.

  return missing;
}

export function readyToWalk(zone: WalkableZone): boolean {
  return missingForWalk(zone).length === 0;
}

/**
 * Zones in the order they are walked, numbered as the sheet numbers them.
 *
 * Numbered by position in the walk rather than by anything stored, so a zone
 * inserted into the middle of a route renumbers the ones after it instead of
 * producing two Zone 3s.
 */
export function walkOrder<T extends { position: number }>(zones: T[]): { number: number; zone: T }[] {
  return [...zones]
    .sort((a, b) => a.position - b.position)
    .map((zone, i) => ({ number: i + 1, zone }));
}

/** How far the walk is, following the line rather than the boundary. */
export function walkMetres(path: LngLat[] | null): number {
  if (!path || path.length < 2) return 0;

  let metres = 0;
  for (let i = 1; i < path.length; i++) metres += metresBetween(path[i - 1], path[i]);
  return metres;
}

/**
 * The distance as somebody about to walk it would say it.
 *
 * Miles to one decimal, because "2.4 miles" is a decision about shoes and
 * "3,862 m" is not.
 */
export function formatWalkDistance(metres: number): string {
  if (metres <= 0) return "No path drawn";
  const miles = metres / METRES_PER_MILE;
  return miles < 0.1 ? "Under 0.1 miles" : `${miles.toFixed(1)} miles`;
}

export interface RouteSummary {
  zones: number;
  /** Zones that could be printed and walked today. */
  ready: number;
  houses: number;
  metres: number;
  /** Every zone that is not ready, with what it is short of. */
  blocked: { name: string; missing: string[] }[];
}

/**
 * The route at a glance, for the person deciding whether to send somebody.
 *
 * Houses and distance count only the zones that are actually ready. A total
 * that includes a zone nobody can walk is a promise the route cannot keep.
 */
export function routeSummary(zones: WalkableZone[]): RouteSummary {
  const ready = zones.filter(readyToWalk);

  return {
    zones: zones.length,
    ready: ready.length,
    houses: ready.reduce((sum, zone) => sum + zone.houseCount, 0),
    metres: ready.reduce((sum, zone) => sum + walkMetres(zone.walkPath), 0),
    blocked: zones
      .filter((zone) => !readyToWalk(zone))
      .map((zone) => ({ name: zone.name, missing: missingForWalk(zone) })),
  };
}

/**
 * Whether a carrier route can be walked with door hangers.
 *
 * USPS walks some routes and drives others, and says which: a city route (C)
 * is a carrier on foot through streets of houses; a rural (R) or highway
 * contract (H) route is a vehicle along roads with houses far apart, and a
 * box route (B) is a wall of boxes at the post office. Only the first is a
 * door-hanger walk. Even a city route can have a main road through it that
 * nobody should be sent to walk along, so the map's road classes are checked
 * at a few points along the route's streets.
 *
 * Pure: a route's verdict, and the reason in words, from what is known.
 */

import type { LngLatPair } from "@/lib/eddm";

export type Walkability = "walkable" | "hard" | "unknown";

export interface WalkVerdict {
  walkability: Walkability;
  reason: string | null;
}

/** The road classes a person should not be sent to walk along with a stack of hangers. */
export const MAIN_ROAD_CLASSES = new Set(["motorway", "motorway_link", "trunk", "trunk_link", "primary", "secondary"]);

const ROUTE_TYPE_LABEL: Record<string, string> = {
  C: "City route",
  R: "Rural route",
  H: "Highway contract route",
  B: "Post office boxes",
  G: "General delivery",
};

/**
 * From USPS's route type alone. Only the types with no doors are settled
 * here: USPS calls most of Harford's subdivisions "rural" because of how the
 * carrier is paid, not how close the houses are, so R and H are judged by
 * density like everything else.
 */
export function routeTypeVerdict(routeType: string | null | undefined): WalkVerdict {
  const type = (routeType ?? "").trim().toUpperCase();
  if (type === "B" || type === "G") {
    return { walkability: "hard", reason: `${ROUTE_TYPE_LABEL[type]}: no doors on this route` };
  }
  return { walkability: "unknown", reason: null };
}

/**
 * Below this many USPS deliveries per kilometre of the route's streets, the
 * houses are too far apart to walk. Quarter-acre lots on both sides of a
 * street give seventy and more, half-acre about forty-five, acre lots about
 * thirty; a road of five-acre lots gives under fifteen. Applied to the
 * routes USPS drives (R and H): a city route (C) is one USPS's own carrier
 * walks, and is walkable by definition, main roads aside.
 */
export const WALK_DENSITY_MIN = 25;

/** Length of the route's streets in kilometres, from their [lng, lat] vertices. */
export function streetKm(paths: LngLatPair[][]): number {
  let metres = 0;
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) metres += metresBetween(path[i - 1], path[i]);
  }
  return metres / 1000;
}

function metresBetween([lng1, lat1]: LngLatPair, [lng2, lat2]: LngLatPair): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** From how many doors there are per kilometre of street, for the routes USPS drives. */
export function densityVerdict(deliveries: number | null | undefined, km: number, routeType?: string | null): WalkVerdict {
  if ((routeType ?? "").trim().toUpperCase() === "C") return { walkability: "unknown", reason: null };
  if (deliveries == null || !(km > 0)) return { walkability: "unknown", reason: null };
  const perKm = deliveries / km;
  if (perKm < WALK_DENSITY_MIN) {
    return { walkability: "hard", reason: `Houses too far apart: ${Math.round(perKm)} deliveries per km of street` };
  }
  return { walkability: "walkable", reason: null };
}

export interface RoadHit {
  class: string;
  name: string | null;
}

/** A route is hard once this share of the checks along its streets meet a main road. */
export const HARD_AT = 1 / 3;

/**
 * From the roads found at each check point along a city route.
 *
 * One check meeting a main road is a route that starts from one, which
 * nearly every neighbourhood does; the walk simply does not go down it.
 * A third of the checks meeting one is a route that runs along it.
 */
export function mainRoadVerdict(checks: RoadHit[][]): WalkVerdict {
  const answered = checks.length;
  if (answered === 0) return { walkability: "unknown", reason: "Roads not checked yet" };
  const hits = checks.filter((roads) => roads.some((r) => MAIN_ROAD_CLASSES.has(r.class)));
  if (hits.length === 0 || hits.length / answered < HARD_AT) return { walkability: "walkable", reason: null };
  const main = hits.flat().filter((r) => MAIN_ROAD_CLASSES.has(r.class));
  const names = [...new Set(main.map((r) => r.name).filter((n): n is string => Boolean(n)))];
  const what = names.length > 0 ? names.slice(0, 3).join(", ") : `${main[0].class.replace("_link", "")} road`;
  return { walkability: "hard", reason: `Main road through the route: ${what} (${hits.length} of ${answered} checks)` };
}

/**
 * The points to check the map's roads at: spread evenly along the route's
 * streets, so a road is found wherever on the route it runs and the cost
 * stays a handful of lookups per route.
 */
export function samplePoints(paths: LngLatPair[][], count = 10): LngLatPair[] {
  const vertices = paths.flat();
  if (vertices.length === 0) return [];
  if (vertices.length <= count) return vertices;
  const out: LngLatPair[] = [];
  for (let i = 0; i < count; i++) {
    const index = Math.floor(((i + 0.5) / count) * vertices.length);
    out.push(vertices[Math.min(index, vertices.length - 1)]);
  }
  return out;
}

export interface RouteFacts {
  routeType: string | null | undefined;
  /** USPS's delivery count for the route. */
  deliveries: number | null | undefined;
  streetKm: number;
}

/**
 * All the checks together: no doors, then too few doors per street, then a
 * main road along the streets. Anything not settled by the first two waits
 * on the roads; with no road answer it is unknown, not walkable.
 */
export function walkVerdict(facts: RouteFacts, checks: RoadHit[][] | null): WalkVerdict {
  const byType = routeTypeVerdict(facts.routeType);
  if (byType.walkability === "hard") return byType;
  const byDensity = densityVerdict(facts.deliveries, facts.streetKm, facts.routeType);
  if (byDensity.walkability === "hard") return byDensity;
  if (checks === null) return { walkability: "unknown", reason: "Roads not checked yet" };
  return mainRoadVerdict(checks);
}

/** Whether the roads still need looking at, given what is already known. */
export function needsRoadCheck(facts: RouteFacts): boolean {
  return (
    routeTypeVerdict(facts.routeType).walkability !== "hard" &&
    densityVerdict(facts.deliveries, facts.streetKm, facts.routeType).walkability !== "hard"
  );
}

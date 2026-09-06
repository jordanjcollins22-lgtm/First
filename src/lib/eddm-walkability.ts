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

/** From USPS's route type alone. Rural and highway routes are driven. */
export function routeTypeVerdict(routeType: string | null | undefined): WalkVerdict {
  const type = (routeType ?? "").trim().toUpperCase();
  if (type === "C") return { walkability: "walkable", reason: null };
  if (type === "R" || type === "H") {
    return { walkability: "hard", reason: `${ROUTE_TYPE_LABEL[type]}: driven by USPS, houses too far apart to walk` };
  }
  if (type === "B" || type === "G") {
    return { walkability: "hard", reason: `${ROUTE_TYPE_LABEL[type]}: no doors on this route` };
  }
  return { walkability: "unknown", reason: null };
}

export interface RoadHit {
  class: string;
  name: string | null;
}

/** From the roads found along a city route. A main road makes it hard. */
export function mainRoadVerdict(roads: RoadHit[]): WalkVerdict {
  const main = roads.filter((r) => MAIN_ROAD_CLASSES.has(r.class));
  if (main.length === 0) return { walkability: "walkable", reason: null };
  const names = [...new Set(main.map((r) => r.name).filter((n): n is string => Boolean(n)))];
  const what = names.length > 0 ? names.slice(0, 3).join(", ") : `${main[0].class.replace("_link", "")} road`;
  return { walkability: "hard", reason: `Main road through the route: ${what}` };
}

/**
 * The points to check the map's roads at: spread evenly along the route's
 * streets, so a road is found wherever on the route it runs and the cost
 * stays a handful of lookups per route.
 */
export function samplePoints(paths: LngLatPair[][], count = 6): LngLatPair[] {
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

/** Both checks together. USPS's type rules first; the roads decide the rest. */
export function walkVerdict(routeType: string | null | undefined, roads: RoadHit[] | null): WalkVerdict {
  const byType = routeTypeVerdict(routeType);
  if (byType.walkability === "hard") return byType;
  if (roads === null) return byType.walkability === "walkable" ? { walkability: "unknown", reason: "Roads not checked yet" } : byType;
  return mainRoadVerdict(roads);
}

/**
 * Pointing the house the right way up.
 *
 * Every property an evaluator opens should look the same way round: the front
 * of the house at the bottom, the way you would stand looking at it from the
 * street. A north-up satellite photo does not do that — half of them arrive
 * sideways or upside down, and an evaluator sketching a back garden onto what
 * is actually the front is a mistake nobody catches until the crew arrives.
 *
 * The front of a house faces its street, so the direction from the house to
 * the nearest road is the direction the front faces. That is the whole idea.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Compass degrees, 0 = north, clockwise. */
export function bearingBetween(from: LatLng, to: LatLng): number {
  const φ1 = toRadians(from.lat);
  const φ2 = toRadians(to.lat);
  const Δλ = toRadians(to.lng - from.lng);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  return normalizeDegrees((Math.atan2(y, x) * 180) / Math.PI);
}

/**
 * The map bearing that puts the front of the house at the bottom.
 *
 * A map bearing says which compass direction sits at the *top* of the frame.
 * We want the way the house faces at the bottom, so the top is the opposite
 * of it — a house whose street is due north is drawn with north at the
 * bottom, which is a map turned all the way round.
 */
export function mapBearingForFrontDown(houseToStreet: number): number {
  return normalizeDegrees(houseToStreet + 180);
}

export function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** Rough distance, good to a metre or so at property scale. */
export function metresBetween(from: LatLng, to: LatLng): number {
  const R = 6_371_000;
  const φ1 = toRadians(from.lat);
  const φ2 = toRadians(to.lat);
  const Δφ = toRadians(to.lat - from.lat);
  const Δλ = toRadians(to.lng - from.lng);

  const a =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const POINTS = [
  "north", "north-east", "east", "south-east",
  "south", "south-west", "west", "north-west",
] as const;

/** How a bearing reads to a person standing in the yard. */
export function describeHeading(degrees: number): string {
  const index = Math.round(normalizeDegrees(degrees) / 45) % 8;
  return POINTS[index];
}

/**
 * Which nearby road is the one the house fronts onto.
 *
 * Nearest wins, but not blindly: a footpath or an alley behind the garden can
 * be closer than the street and would turn the whole picture round. Anything
 * that is not a road people drive to a house on has to be a good deal closer
 * before it is believed.
 */
export interface RoadCandidate extends LatLng {
  distanceMetres: number;
  roadClass: string | null;
}

const FRONTING_CLASSES = new Set([
  "street",
  "street_limited",
  "primary",
  "secondary",
  "tertiary",
  "trunk",
  "motorway",
  "motorway_link",
  "service",
  "driveway",
]);

export function pickFrontingRoad(candidates: RoadCandidate[]): RoadCandidate | null {
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => a.distanceMetres - b.distanceMetres);
  const proper = sorted.find((c) => c.roadClass != null && FRONTING_CLASSES.has(c.roadClass));
  if (!proper) return sorted[0];

  const nearest = sorted[0];
  if (nearest === proper) return proper;

  // A path only wins if it is dramatically closer — otherwise the street is
  // the front, whatever is running along the back fence.
  return nearest.distanceMetres * 3 < proper.distanceMetres ? nearest : proper;
}

/**
 * The whole job: where the house is, what is near it, which way to turn the
 * map. Null when there is nothing near enough to be a street, in which case
 * the evaluator turns it themselves.
 */
export function autoBearing(house: LatLng, candidates: RoadCandidate[]): number | null {
  const road = pickFrontingRoad(candidates);
  if (!road) return null;
  // Two points on top of each other give a meaningless bearing.
  if (road.distanceMetres < 1) return null;

  return mapBearingForFrontDown(bearingBetween(house, road));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

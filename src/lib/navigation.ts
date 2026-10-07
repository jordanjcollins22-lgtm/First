/**
 * Following a route while somebody drives it.
 *
 * The difference between a list of turns and navigation is entirely
 * arithmetic. Given where the phone says you are and the route you were
 * given, everything a driver needs falls out of a handful of distances: which
 * instruction is next, how far away it is, how long is left, and whether you
 * are still on the road at all.
 *
 * All of it derived from the current position. Nothing here remembers where
 * you were a moment ago, because a navigator that accumulates state drifts —
 * one missed reading and it is confidently describing a different journey.
 * Recomputed from scratch on every fix, it can be wrong for one second and
 * right on the next.
 *
 * Deliberately not a re-implementation of a satnav. No lane guidance, no
 * spoken prompts, no traffic. It answers "what do I do next and how long have
 * I got", which is the question somebody driving a truck to a garden has.
 */

export interface LngLat {
  lng: number;
  lat: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const METRES_PER_MILE = 1609.344;
const METRES_PER_FOOT = 0.3048;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Metres between two points on the globe.
 *
 * Haversine rather than a flat approximation. A route in one county could be
 * measured flat without anybody noticing, but the error grows with latitude
 * and there is no reason to build something that only works near home.
 */
export function metresBetween(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface SnapResult {
  /** Index of the nearest point on the route line. */
  index: number;
  /** How far off the line the driver is, in metres. */
  offRouteMetres: number;
}

/**
 * The point on the route the driver is closest to.
 *
 * Measured against the route's own vertices rather than against the segments
 * between them. A Mapbox line has a vertex every few metres on anything a
 * truck can drive down, so the difference is smaller than a phone's own
 * accuracy, and segment projection is a great deal of arithmetic to be
 * fractionally more precise than the input.
 */
export function snapToRoute(position: LngLat, coordinates: [number, number][]): SnapResult | null {
  if (coordinates.length === 0) return null;

  let index = 0;
  let best = Infinity;

  for (let i = 0; i < coordinates.length; i++) {
    const [lng, lat] = coordinates[i];
    const distance = metresBetween(position, { lng, lat });
    if (distance < best) {
      best = distance;
      index = i;
    }
  }

  return { index, offRouteMetres: best };
}

/** Metres still to drive, from where the driver actually is. */
export function remainingMetres(
  position: LngLat,
  coordinates: [number, number][],
  snap: SnapResult
): number {
  if (coordinates.length === 0) return 0;

  // From the driver to the line, then along what is left of it. Including the
  // hop onto the line matters when somebody is a street away: without it the
  // distance drops to zero while they are still driving.
  const [lng, lat] = coordinates[snap.index];
  let total = metresBetween(position, { lng, lat });

  for (let i = snap.index; i < coordinates.length - 1; i++) {
    const [aLng, aLat] = coordinates[i];
    const [bLng, bLat] = coordinates[i + 1];
    total += metresBetween({ lng: aLng, lat: aLat }, { lng: bLng, lat: bLat });
  }

  return total;
}

export interface NavStep {
  instruction: string;
  location: [number, number] | null;
}

/**
 * Which instruction the driver needs now.
 *
 * The first turn they have not yet reached, measured along the route rather
 * than by straight-line distance. A route that doubles back — down a lane and
 * out again — passes close to a later turn while an earlier one is still to
 * come, and picking the nearest would jump the instructions about.
 */
export function currentStepIndex(
  steps: NavStep[],
  coordinates: [number, number][],
  snap: SnapResult
): number {
  if (steps.length === 0) return -1;

  for (let i = 0; i < steps.length; i++) {
    const location = steps[i].location;
    if (!location) continue;

    const stepSnap = snapToRoute({ lng: location[0], lat: location[1] }, coordinates);
    // A turn still ahead of where the driver has got to on the line.
    if (stepSnap && stepSnap.index > snap.index) return i;
  }

  // Past every turn: the last instruction is the arrival one.
  return steps.length - 1;
}

/** Metres to the turn being announced. Null when the step has no location to
 * measure to, which is not zero — zero would announce "turn now". */
export function metresToStep(position: LngLat, step: NavStep | undefined): number | null {
  if (!step?.location) return null;
  return metresBetween(position, { lng: step.location[0], lat: step.location[1] });
}

/**
 * Seconds left, scaled from the route's own estimate.
 *
 * Mapbox's duration is for the whole route at the speeds it expects. Taking
 * the fraction still to drive keeps whatever it knew about the roads without
 * pretending to model traffic this app cannot see.
 */
export function remainingSeconds(route: { distance: number; duration: number }, left: number): number {
  if (route.distance <= 0) return 0;
  const fraction = Math.max(0, Math.min(1, left / route.distance));
  return Math.round(route.duration * fraction);
}

/**
 * Close enough to be there.
 *
 * Generous on purpose. A phone in a truck cab is routinely thirty metres out,
 * and a driver parked on the drive being told they have not arrived is worse
 * than one told they have while still rolling up it.
 */
export const ARRIVAL_METRES = 60;

export function hasArrived(position: LngLat, destination: LngLat): boolean {
  return metresBetween(position, destination) <= ARRIVAL_METRES;
}

/**
 * Far enough off the line to need a new route.
 *
 * Well beyond any plausible GPS error, because re-routing on noise is how a
 * navigator starts shouting at somebody sitting still at a junction.
 */
export const OFF_ROUTE_METRES = 50;

export function isOffRoute(snap: SnapResult | null): boolean {
  return snap != null && snap.offRouteMetres > OFF_ROUTE_METRES;
}

/**
 * Distance the way a driver hears it.
 *
 * Feet close in, miles further out, and rounded to something sayable: nobody
 * needs "487 feet", and a number that precise reads as a machine talking.
 */
export function spokenDistance(metres: number | null): string {
  if (metres == null || !Number.isFinite(metres) || metres < 0) return "";
  if (metres < 15) return "Now";

  const feet = metres / METRES_PER_FOOT;
  if (feet < 1000) {
    const rounded = feet < 150 ? Math.round(feet / 50) * 50 : Math.round(feet / 100) * 100;
    return `${rounded} ft`;
  }

  const miles = metres / METRES_PER_MILE;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

/** Time the way a driver hears it. */
export function spokenDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 min";
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** The clock time they should get there, for somebody who wants to tell a
 * client rather than watch a countdown. */
export function arrivalClock(seconds: number, now = new Date()): string {
  const at = new Date(now.getTime() + Math.max(0, seconds) * 1000);
  return at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export interface NavState {
  arrived: boolean;
  offRoute: boolean;
  stepIndex: number;
  instruction: string;
  metresToTurn: number | null;
  remainingMetres: number;
  remainingSeconds: number;
}

/**
 * Everything the screen needs, from one position fix.
 *
 * One function so the parts cannot disagree with each other — an ETA worked
 * out from one snap and a turn worked out from another is how a navigator
 * says "turn left in 200 feet, arriving now".
 */
export function navigate(input: {
  position: LngLat;
  destination: LngLat;
  route: { distance: number; duration: number; coordinates: [number, number][]; steps: NavStep[] };
}): NavState {
  const { position, destination, route } = input;

  if (hasArrived(position, destination)) {
    return {
      arrived: true,
      offRoute: false,
      stepIndex: route.steps.length - 1,
      instruction: "You have arrived.",
      metresToTurn: 0,
      remainingMetres: 0,
      remainingSeconds: 0,
    };
  }

  const snap = snapToRoute(position, route.coordinates);
  const stepIndex = currentStepIndex(route.steps, route.coordinates, snap ?? { index: 0, offRouteMetres: 0 });
  const step = route.steps[stepIndex];
  const left = snap ? remainingMetres(position, route.coordinates, snap) : route.distance;

  return {
    arrived: false,
    offRoute: isOffRoute(snap),
    stepIndex,
    instruction: step?.instruction ?? "",
    metresToTurn: metresToStep(position, step),
    remainingMetres: left,
    remainingSeconds: remainingSeconds(route, left),
  };
}

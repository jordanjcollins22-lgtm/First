/**
 * Getting to the next stop, without leaving the app.
 *
 * Every "Directions" link in here used to throw the crew out to Google Maps.
 * That works, but it is a one-way door: they leave, the app loses the thread,
 * and the tap that says "I'm on the way" is now three apps back. On a phone in
 * a truck that is the difference between a day that gets logged and one that
 * does not.
 *
 * So the route is drawn and the turns are listed here. What this deliberately
 * does not attempt is live voice-guided navigation — re-routing, lane
 * guidance, traffic spoken aloud. Google and Apple are very good at that and
 * this would be a worse copy, so the escape hatch to a real navigation app
 * stays one tap away for anybody who wants it.
 */

export interface RouteStep {
  /** "Turn left onto Crafton Road" — Mapbox's own wording, which is good. */
  instruction: string;
  /** Metres to the next turn. */
  distance: number;
  /** The road being travelled, when it has a name. */
  name: string;
}

export interface Route {
  /** Metres. */
  distance: number;
  /** Seconds. */
  duration: number;
  steps: RouteStep[];
  /** GeoJSON LineString coordinates, for drawing the line. */
  coordinates: [number, number][];
}

const METRES_PER_MILE = 1609.344;

/**
 * Distance the way somebody driving would say it.
 *
 * Feet under a tenth of a mile, because "0.04 miles" is not a thing anybody
 * says or can judge out of a windscreen.
 */
export function formatDistance(metres: number): string {
  const miles = metres / METRES_PER_MILE;
  if (miles < 0.1) {
    const feet = Math.round(metres * 3.28084);
    return `${Math.max(1, Math.round(feet / 10) * 10)} ft`;
  }
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

/** Duration in the shape of an answer to "how long?". */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** When they would get there, leaving now. The number a client actually
 * asked for when they rang to ask where the crew is. */
export function arrivalTime(seconds: number, now: Date = new Date()): string {
  return new Date(now.getTime() + seconds * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The shape Mapbox's Directions API returns, narrowed to what is used. */
export interface MapboxDirectionsResponse {
  routes?: {
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: [number, number][] };
    legs?: { steps?: { maneuver?: { instruction?: string }; distance?: number; name?: string }[] }[];
  }[];
}

/**
 * The first route, in this app's shape.
 *
 * Returns null rather than a half-built route when the response is not usable:
 * a directions panel showing a distance and no line is worse than one that
 * says it could not work out the way, because the first looks like it worked.
 */
export function parseRoute(body: MapboxDirectionsResponse): Route | null {
  const route = body.routes?.[0];
  if (!route) return null;

  const coordinates = route.geometry?.coordinates ?? [];
  if (coordinates.length < 2) return null;

  const steps: RouteStep[] = (route.legs ?? []).flatMap((leg) =>
    (leg.steps ?? [])
      .map((step) => ({
        instruction: step.maneuver?.instruction?.trim() ?? "",
        distance: step.distance ?? 0,
        name: step.name?.trim() ?? "",
      }))
      // A step with no words is not an instruction, and printing a blank row
      // makes the list look broken rather than short.
      .filter((step) => step.instruction.length > 0)
  );

  return {
    distance: route.distance ?? 0,
    duration: route.duration ?? 0,
    steps,
    coordinates,
  };
}

/** The bounding box of the route, for framing the map on it. */
export function routeBounds(coordinates: [number, number][]): [[number, number], [number, number]] | null {
  if (coordinates.length === 0) return null;
  let minLng = coordinates[0][0];
  let minLat = coordinates[0][1];
  let maxLng = minLng;
  let maxLat = minLat;
  for (const [lng, lat] of coordinates) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

/**
 * The escape hatch to a real navigation app.
 *
 * Kept because this is not turn-by-turn voice guidance and pretending
 * otherwise would strand somebody on a dual carriageway. Coordinates when we
 * have them — an address string is re-geocoded by the other app and can land
 * on the wrong Elm Street.
 */
export function externalNavUrl(
  destination: { lat: number | null; lng: number | null; address: string }
): string {
  if (destination.lat != null && destination.lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}&travelmode=driving`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination.address)}&travelmode=driving`;
}

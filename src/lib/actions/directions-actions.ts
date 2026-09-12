"use server";

import { env } from "@/lib/env";
import { parseRoute, type MapboxDirectionsResponse, type Route } from "@/lib/directions";

export type DirectionsResult = { ok: true; route: Route } | { ok: false; message: string };

/**
 * The driving route between two points.
 *
 * Fetched on the server rather than from the phone so a Mapbox outage, a rate
 * limit or a bad token becomes a sentence the crew can read instead of a
 * silent failure in a console nobody is looking at from a truck.
 *
 * Returns a result rather than throwing: Next.js strips thrown messages in
 * production, and "something went wrong" is useless to somebody parked at the
 * end of a road trying to work out which way to turn.
 */
export async function getDrivingRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Promise<DirectionsResult> {
  if (!env.mapboxToken) {
    return { ok: false, message: "Maps aren't set up on this account yet." };
  }
  if (![from.lat, from.lng, to.lat, to.lng].every((n) => Number.isFinite(n))) {
    return { ok: false, message: "Couldn't work out where to start from." };
  }

  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}` +
    `?geometries=geojson&overview=full&steps=true&access_token=${env.mapboxToken}`;

  try {
    // Traffic and roadworks change; a route cached for an hour would be a
    // confidently wrong one. A minute is enough to cover a double tap.
    const response = await fetch(url, { next: { revalidate: 60 } });
    if (!response.ok) {
      return { ok: false, message: "Couldn't get directions right now — try again in a moment." };
    }

    const route = parseRoute((await response.json()) as MapboxDirectionsResponse);
    if (!route) {
      return { ok: false, message: "No driving route to that address. Check the pin on the property." };
    }
    return { ok: true, route };
  } catch (err) {
    console.error("getDrivingRoute failed:", err);
    return { ok: false, message: "Couldn't reach the map service. Check your signal and try again." };
  }
}

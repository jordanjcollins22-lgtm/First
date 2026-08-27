import { env } from "@/lib/env";

import { metresBetween, type LatLng, type RoadCandidate } from "@/lib/orientation";

/**
 * The roads around a property.
 *
 * Mapbox's Tilequery answers "what map features are near this point" and
 * snaps each one to its nearest position on the feature, which is exactly the
 * question here: where is the street, from the house. Same token as the
 * satellite photo, so there is nothing extra to set up.
 */
export async function nearbyRoads(
  point: LatLng,
  radiusMetres = 120,
  signal?: AbortSignal
): Promise<RoadCandidate[]> {
  if (!env.mapboxToken) return [];

  const url = new URL(
    `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${point.lng},${point.lat}.json`
  );
  url.searchParams.set("radius", String(radiusMetres));
  url.searchParams.set("limit", "20");
  url.searchParams.set("dedupe", "true");
  url.searchParams.set("layers", "road");
  url.searchParams.set("access_token", env.mapboxToken);

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) return [];

  const json = (await response.json()) as {
    features?: {
      geometry?: { type: string; coordinates: [number, number] };
      properties?: { class?: string; tilequery?: { distance?: number } };
    }[];
  };

  return (json.features ?? [])
    .filter((feature) => feature.geometry?.type === "Point")
    .map((feature) => {
      const [lng, lat] = feature.geometry!.coordinates;
      // Tilequery reports its own distance, but not always — measuring it
      // ourselves means one rule for every candidate.
      const distanceMetres =
        feature.properties?.tilequery?.distance ?? metresBetween(point, { lat, lng });

      return {
        lat,
        lng,
        distanceMetres,
        roadClass: feature.properties?.class ?? null,
      };
    });
}

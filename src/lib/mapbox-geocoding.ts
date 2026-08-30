import { env } from "@/lib/env";
import { HOME_POINT } from "@/lib/geocode-guard";

export interface GeocodeSuggestion {
  id: string;
  fullAddress: string;
  lat: number;
  lng: number;
}

/**
 * Looks an address up, weighted towards where this business works.
 *
 * Unweighted, a geocoder answers the question it was asked: "1103 Sunset
 * Drive" is a real street in Fort Frances, Ontario, and it will say so. That
 * is how a landscaping business in Harford County ended up with pins in
 * Toronto, Chicago and Memphis. So every lookup is limited to the United
 * States and biased towards the county, and `autocomplete` is off for a
 * finished address — it exists for a half-typed one and only makes a
 * complete address fuzzier.
 */
export async function searchAddress(
  query: string,
  signal?: AbortSignal,
  options: { autocomplete?: boolean } = {}
): Promise<GeocodeSuggestion[]> {
  if (!query.trim() || !env.mapboxToken) return [];

  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`
  );
  url.searchParams.set("access_token", env.mapboxToken);
  url.searchParams.set("autocomplete", options.autocomplete === false ? "false" : "true");
  url.searchParams.set("country", "us");
  url.searchParams.set("proximity", `${HOME_POINT.lng},${HOME_POINT.lat}`);
  url.searchParams.set("types", "address,poi");
  url.searchParams.set("limit", "5");

  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`Geocoding request failed: ${res.status}`);
  const json = await res.json();

  return (json.features ?? []).map(
    (f: { id: string; place_name: string; center: [number, number] }) => ({
      id: f.id,
      fullAddress: f.place_name,
      lng: f.center[0],
      lat: f.center[1],
    })
  );
}

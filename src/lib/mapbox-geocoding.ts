import { env } from "@/lib/env";

export interface GeocodeSuggestion {
  id: string;
  fullAddress: string;
  lat: number;
  lng: number;
}

export async function searchAddress(
  query: string,
  signal?: AbortSignal
): Promise<GeocodeSuggestion[]> {
  if (!query.trim() || !env.mapboxToken) return [];

  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`
  );
  url.searchParams.set("access_token", env.mapboxToken);
  url.searchParams.set("autocomplete", "true");
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

import { env } from "@/lib/env";
import { credentialsFor } from "@/lib/integrations/store";

/**
 * Where the listing comes in a Google Maps search made from one point: the
 * same lookup the rank tracker's "Run" button makes (rank-grid-actions.ts),
 * here so a scheduled run can make it without anybody signed in.
 *
 * Null rank means not in the results at all, which is different from last.
 */

export interface PlacesKey {
  apiKey: string;
  placeId: string;
}

/** The saved key (Settings › Integrations), else the old environment variables, else nothing. */
export async function placesKeyFor(organizationId: string): Promise<PlacesKey | null> {
  const saved = await credentialsFor(organizationId, "google_places").catch(() => null);
  if (saved?.api_key && saved?.place_id) return { apiKey: saved.api_key, placeId: saved.place_id };
  if (env.googlePlacesApiKey && env.googlePlaceId) return { apiKey: env.googlePlacesApiKey, placeId: env.googlePlaceId };
  return null;
}

export async function placesRank(key: PlacesKey, phrase: string, lat: number, lng: number): Promise<{ ok: true; rank: number | null } | { ok: false; error: string }> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", phrase);
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("radius", "5000");
  url.searchParams.set("key", key.apiKey);
  try {
    const response = await fetch(url.toString());
    const json = (await response.json().catch(() => ({}))) as { status?: string; error_message?: string; results?: { place_id?: string }[] };
    if (!response.ok || (json.status && json.status !== "OK" && json.status !== "ZERO_RESULTS")) {
      return { ok: false, error: json.error_message || json.status || `Google answered ${response.status}.` };
    }
    const index = (json.results ?? []).findIndex((r) => r.place_id === key.placeId);
    return { ok: true, rank: index === -1 ? null : index + 1 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not reach Google." };
  }
}

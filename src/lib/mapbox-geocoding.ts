import { env } from "@/lib/env";
import { HOME_POINT } from "@/lib/geocode-guard";
import { fetchJson } from "@/lib/resilient-fetch";

export interface GeocodeSuggestion {
  id: string;
  fullAddress: string;
  lat: number;
  lng: number;
}

/**
 * A lookup that came back, or the reason it did not.
 *
 * The distinction matters more here than anywhere else in the app. "Mapbox
 * found nothing" and "Mapbox did not answer" both leave us without
 * coordinates, but the first is a fact about the address and the second is a
 * fact about this minute. Collapsing them is how a five-minute outage gets
 * written into a thousand contact rows as "couldn't be found" and never looked
 * at again.
 */
export type AddressLookup =
  | { ok: true; suggestions: GeocodeSuggestion[] }
  | { ok: false; reason: string; retryable: boolean };

/** Interactive enough that a person is watching, so the deadline is short. */
const LOOKUP_TIMEOUT_MS = 4_000;
/** One retry. Enough to ride out a blip, few enough to stay inside a request. */
const LOOKUP_ATTEMPTS = 2;

interface MapboxResponse {
  features?: { id: string; place_name: string; center: [number, number] }[];
}

function buildUrl(query: string, token: string, autocomplete: boolean): URL {
  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`
  );
  url.searchParams.set("access_token", token);
  url.searchParams.set("autocomplete", autocomplete ? "true" : "false");
  url.searchParams.set("country", "us");
  url.searchParams.set("proximity", `${HOME_POINT.lng},${HOME_POINT.lat}`);
  url.searchParams.set("types", "address,poi");
  url.searchParams.set("limit", "5");
  return url;
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
 *
 * When Mapbox is slow or down: the call gives up after a few seconds rather
 * than holding the request open, and says so with `retryable` set, so a caller
 * placing addresses in bulk can leave the row in the queue instead of burning
 * it. An unconfigured token is not retryable — no amount of waiting supplies
 * one — and comes back as an empty list of suggestions, which is what every
 * search box already knows how to show.
 */
export async function lookupAddress(
  query: string,
  signal?: AbortSignal,
  options: { autocomplete?: boolean } = {}
): Promise<AddressLookup> {
  if (!query.trim() || !env.mapboxToken) return { ok: true, suggestions: [] };

  const url = buildUrl(query, env.mapboxToken, options.autocomplete !== false);

  const outcome = await fetchJson<MapboxResponse>(url, {
    signal,
    timeoutMs: LOOKUP_TIMEOUT_MS,
    attempts: LOOKUP_ATTEMPTS,
  });

  if (!outcome.ok) {
    return {
      ok: false,
      reason: `Address lookup unavailable: ${outcome.message}`,
      retryable: outcome.retryable,
    };
  }

  return {
    ok: true,
    suggestions: (outcome.value.features ?? []).map((f) => ({
      id: f.id,
      fullAddress: f.place_name,
      lng: f.center[0],
      lat: f.center[1],
    })),
  };
}

/**
 * The same lookup for callers that only have two outcomes to offer.
 *
 * Every search box in the app already wraps this in a try and shows nothing on
 * a throw, so the throw is kept rather than quietly turned into "no matches" —
 * a caller that tells a person "no match for that address" during an outage is
 * telling them something untrue about their address. Anything deciding what to
 * write to the database should use `lookupAddress` and read `retryable`.
 */
export async function searchAddress(
  query: string,
  signal?: AbortSignal,
  options: { autocomplete?: boolean } = {}
): Promise<GeocodeSuggestion[]> {
  const lookup = await lookupAddress(query, signal, options);
  if (!lookup.ok) throw new Error(lookup.reason);
  return lookup.suggestions;
}

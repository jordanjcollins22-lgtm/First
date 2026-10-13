import { placesRank } from "@/lib/google/places-rank";
import type { IntegrationProvider } from "@/lib/integrations/types";

/**
 * The rank tracker's search key: Google Places text search from points round
 * each town, to see where the listing comes for "lawn care Bel Air" and the
 * rest. The tracker already used GOOGLE_PLACES_API_KEY and GOOGLE_PLACE_ID
 * from the environment; saved here they work without a redeploy.
 */
export const googlePlacesProvider: IntegrationProvider = {
  id: "google_places",
  name: "Rank tracker (Google Places search)",
  area: "Marketing",
  enables: "A weekly check of where the business comes in Google Maps for each town and service.",
  fields: [
    { key: "api_key", label: "Places API key", secret: true, help: "Google Cloud › Credentials › API key, restricted to the Places API." },
    { key: "place_id", label: "Your Place ID", placeholder: "ChIJ…", help: "Find it with Google's Place ID Finder." },
  ],
  howTo: [
    "In Google Cloud Console, enable the Places API and make an API key restricted to it (billing must be on; about $32 per 1,000 searches).",
    "Find the business's Place ID at developers.google.com/maps/documentation/places/web-service/place-id.",
    "Paste both here. The weekly check is capped in Marketing › Digital marketing so the bill stays small.",
  ],
  docsUrl: "https://developers.google.com/maps/documentation/places/web-service/text-search",
  async test(secrets) {
    if (!secrets.api_key || !secrets.place_id) return { ok: false, error: "Add both the API key and the Place ID." };
    const r = await placesRank({ apiKey: secrets.api_key, placeId: secrets.place_id }, "landscaping Bel Air MD", 39.5359, -76.3483);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  },
};

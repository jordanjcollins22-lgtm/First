import { fetchJson } from "../http";

/**
 * Google Places API (New) Text Search — the automated version of googling
 * "HVAC repair near Fort Hancock, NJ" and working down the list.
 * Needs GOOGLE_PLACES_API_KEY (~$32 per 1,000 searches after the free tier).
 */
const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
  "places.location",
  "places.addressComponents",
].join(",");

export interface PlaceResult {
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  lat: number | null;
  lng: number | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

interface PlacesResponse {
  places?: Array<{
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    websiteUri?: string;
    rating?: number;
    userRatingCount?: number;
    businessStatus?: string;
    location?: { latitude?: number; longitude?: number };
    addressComponents?: Array<{ shortText?: string; types?: string[] }>;
  }>;
}

export async function searchPlaces(apiKey: string, textQuery: string, pageSize = 20): Promise<PlaceResult[]> {
  const data = await fetchJson<PlacesResponse>(ENDPOINT, {
    method: "POST",
    headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELDS },
    body: { textQuery, pageSize, regionCode: "US" },
  });
  return (data.places ?? [])
    .filter((p) => !p.businessStatus || p.businessStatus === "OPERATIONAL")
    .map((p) => {
      const comp = (type: string) => p.addressComponents?.find((c) => c.types?.includes(type))?.shortText ?? null;
      return {
        placeId: p.id,
        name: p.displayName?.text ?? "Unknown",
        address: p.formattedAddress ?? null,
        phone: p.nationalPhoneNumber ?? null,
        website: p.websiteUri ?? null,
        rating: p.rating ?? null,
        reviewCount: p.userRatingCount ?? null,
        lat: p.location?.latitude ?? null,
        lng: p.location?.longitude ?? null,
        city: comp("locality"),
        state: comp("administrative_area_level_1"),
        zip: comp("postal_code"),
      };
    });
}

/**
 * The landing page hands the address to the booking form in the link, so
 * nobody types it twice: /book?address=…&lat=…&lng=…, with "located" when it
 * came from the phone's location, and whatever the landing link carried
 * (an affiliate's ?ref=, ?org=, ?rec=) passed along. The booking form reads
 * it back with readStartAddress. Pure, so both ends are tested together.
 */

import type { GeocodeSuggestion } from "@/lib/mapbox-geocoding";

const CARRIED = ["ref", "org", "rec"] as const;

export function bookingLinkFor(
  found: Pick<GeocodeSuggestion, "fullAddress" | "lat" | "lng">,
  options: { located: boolean; carry?: { get(name: string): string | null } | null }
): string {
  const params = new URLSearchParams();
  for (const name of CARRIED) {
    const value = options.carry?.get(name);
    if (value) params.set(name, value);
  }
  params.set("address", found.fullAddress);
  params.set("lat", String(found.lat));
  params.set("lng", String(found.lng));
  if (options.located) params.set("located", "1");
  return `/book?${params.toString()}`;
}

/** The address a landing link brought, or null when it brought none or nonsense. */
export function readStartAddress(params: { get(name: string): string | null }): { address: GeocodeSuggestion; located: boolean } | null {
  const fullAddress = (params.get("address") ?? "").trim().slice(0, 300);
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  if (!fullAddress || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { address: { id: "from-start", fullAddress, lat, lng }, located: params.get("located") === "1" };
}

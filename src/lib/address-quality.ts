/**
 * Whether an address is a house, and whether to believe where it says it is.
 *
 * Identity is the normalized address text. Coordinates are enrichment, and the
 * existing data is why: the property table holds a Bel Air street geocoded to
 * Milan, Missouri, another to Port Macquarie, and one to Austria. The text was
 * right every time. A system that keyed on coordinates would have created
 * three houses on three continents for one street in Harford County.
 *
 * So this judges the text, uses the coordinates only to raise a doubt, and
 * never lets either quietly overrule the other. Anything it cannot settle is
 * held back for a person rather than drawn on the map as though it were known.
 */

import { houseNumber, normalizeAddress } from "@/lib/address-normalize";
import { metresBetween } from "@/lib/navigation";

/**
 * Bump when the normalizer's output changes for any input.
 *
 * Stored on every house beside its key, so a later improvement can find the
 * rows written by the old algorithm and regenerate exactly those. Without it
 * the only safe options are regenerating everything or trusting that nothing
 * changed, and one of those is expensive and the other is a guess.
 */
export const NORMALIZER_VERSION = 1;

/** Harford County, generously. Corners rather than a real boundary. */
const HARFORD_BOX = { minLat: 39.3, maxLat: 39.75, minLng: -76.6, maxLng: -75.98 };

/** Roughly Bel Air, for saying how far wrong a geocode is. */
const HARFORD_CENTRE = { lat: 39.5359, lng: -76.3483 };

/**
 * How far from Bel Air the business could conceivably work, in miles.
 *
 * Generous on purpose: it comfortably covers Maryland and every neighbouring
 * state, so a real customer over a border is never questioned. What it catches
 * is the other continent.
 *
 * That case is not a bad pin on a good address. The geocoder rewrote the
 * address as well: "907 Red Pump Road, Bel Air" became "Red Pump Road, Milan,
 * Missouri", and "319 Crestwood Drive, Edgewood" became the same house number
 * and street in Port Macquarie, Australia. The text no longer claims Harford,
 * so the mismatch rule cannot see it, and distance is what is left.
 */
const SERVICE_RADIUS_MILES = 150;

const METRES_PER_MILE = 1609.344;

/**
 * ZIP codes that are Harford County and nothing else.
 *
 * Deliberately not a complete list of everywhere the business works. Its only
 * job is to say "the text claims Harford", so a neighbouring county's ZIP being
 * absent costs nothing -- that address simply is not claimed, and nothing is
 * flagged about it.
 */
const HARFORD_ZIPS = new Set([
  "21001", "21005", "21009", "21014", "21015", "21017", "21028", "21034",
  "21040", "21047", "21050", "21078", "21084", "21085", "21130", "21132",
  "21154", "21160",
]);

const HARFORD_TOWNS = [
  "ABERDEEN", "ABINGDON", "BEL AIR", "BELCAMP", "CHURCHVILLE", "DARLINGTON",
  "EDGEWOOD", "FALLSTON", "FOREST HILL", "HAVRE DE GRACE", "JARRETTSVILLE",
  "JOPPA", "PERRYMAN", "PYLESVILLE", "WHITEFORD",
];

export type AddressKind =
  /** A specific dwelling: has a house number. */
  | "house"
  /** A street with no number on it. Real, and not one address. */
  | "street"
  /** Nothing usable came out of the normalizer. */
  | "unusable";

export interface AddressAssessment {
  kind: AddressKind;
  /**
   * Whether a person should look before this is treated as a house on the map.
   *
   * A street is always held back: drawing a marker for "Emmorton Road" puts one
   * pin on a road with four hundred houses on it, and every count that pin
   * feeds is then wrong.
   */
  needsReview: boolean;
  /** Why, in the words the review queue shows. Empty when nothing is wrong. */
  reasons: string[];
  /** Whether the text places this in Harford County. */
  claimsHarford: boolean;
  /** How far the coordinates are from Harford, when both are known. */
  metresFromHarford: number | null;
}

/** Whether a point is inside the county box. */
export function withinHarford(lat: number | null, lng: number | null): boolean {
  if (lat == null || lng == null) return false;
  return (
    lat >= HARFORD_BOX.minLat &&
    lat <= HARFORD_BOX.maxLat &&
    lng >= HARFORD_BOX.minLng &&
    lng <= HARFORD_BOX.maxLng
  );
}

/**
 * Whether the address text says Harford County.
 *
 * ZIP first, because a ZIP is unambiguous and a town name is not: there is an
 * Aberdeen in Scotland, Washington and New Jersey, and the business has a
 * customer record for one of them.
 */
export function claimsHarford(raw: string | null | undefined): boolean {
  const normalized = normalizeAddress(raw);
  if (!normalized) return false;

  for (const zip of normalized.match(/\b\d{5}\b/g) ?? []) {
    if (HARFORD_ZIPS.has(zip)) return true;
  }
  // A town only counts alongside Maryland, which is what rules out the other
  // Aberdeens.
  if (!/\bMD\b/.test(normalized)) return false;
  return HARFORD_TOWNS.some((town) => normalized.includes(town));
}

/**
 * What this address is, and whether to trust it.
 *
 * Coordinates are an input to the doubt and never to the identity. A house
 * whose text says Bel Air and whose pin says Missouri is a Bel Air house with a
 * bad pin, not a Missouri house.
 */
export function assessAddress(
  raw: string | null | undefined,
  coords?: { lat: number | null; lng: number | null } | null
): AddressAssessment {
  const reasons: string[] = [];
  const normalized = normalizeAddress(raw);
  const harford = claimsHarford(raw);

  const metresFromHarford =
    coords?.lat != null && coords?.lng != null
      ? Math.round(metresBetween({ lat: coords.lat, lng: coords.lng }, HARFORD_CENTRE))
      : null;

  let kind: AddressKind = "house";
  if (!normalized) {
    kind = "unusable";
    reasons.push("No usable address");
  } else if (!houseNumber(raw)) {
    kind = "street";
    reasons.push("A street with no house number, not a single address");
  }

  // The mismatch that matters: the text names Harford and the pin does not.
  // Reported in miles because "the pin is 900 miles out" is a sentence a person
  // can act on and 1448000 metres is not.
  if (harford && coords?.lat != null && coords?.lng != null && !withinHarford(coords.lat, coords.lng)) {
    const miles = Math.round((metresFromHarford ?? 0) / METRES_PER_MILE);
    reasons.push(`Address says Harford County but the pin is about ${miles} miles away`);
  } else if (metresFromHarford != null && metresFromHarford / METRES_PER_MILE > SERVICE_RADIUS_MILES) {
    // Nothing claimed Harford, so nothing contradicts itself -- and it is
    // still not a house to draw on this map without somebody looking.
    const miles = Math.round(metresFromHarford / METRES_PER_MILE);
    reasons.push(`Pinned about ${miles} miles from the service area`);
  }

  return {
    kind,
    // A street is never a house marker, and a Harford address pinned elsewhere
    // is not safe to place until somebody says which half is wrong.
    needsReview: kind !== "house" || reasons.length > 0,
    reasons,
    claimsHarford: harford,
    metresFromHarford,
  };
}

/**
 * The house number and street, without the town, state or ZIP.
 *
 * The fingerprint of a rewritten address: "319 CRESTWOOD DR" appears once in
 * Edgewood and once in Port Macquarie, and they are one house. Offered for the
 * importer to compare against, not used here, because spotting it needs every
 * other house and this file judges one at a time.
 */
export function streetPrefix(raw: string | null | undefined, words = 3): string {
  return normalizeAddress(raw).split(" ").slice(0, words).join(" ");
}

/**
 * Whether a county parcel may be attached to an existing house automatically.
 *
 * Exact normalized equality only. Everything else is a review, because the
 * failure mode is not a missing pin -- it is a stranger's parcel welded to a
 * customer record, which shows up as the wrong name on a proposal and is found
 * by the client rather than by us.
 *
 * Coordinates deliberately play no part. They are the thing that was wrong.
 */
export function canLinkAutomatically(
  existingNormalized: string | null | undefined,
  incomingNormalized: string | null | undefined
): boolean {
  return Boolean(existingNormalized) && existingNormalized === incomingNormalized;
}

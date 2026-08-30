/**
 * Refusing a geocoder's answer when it is obviously not the place.
 *
 * A bulk import hands a geocoder a line of text and takes back a point. Given
 * "1103 Sunset Drive" with no town on it, Mapbox will happily answer with
 * Fort Frances, Ontario — a real Sunset Drive, on the wrong side of a
 * national border, and the map ends up with pins in Toronto, Chicago and
 * Memphis for a landscaping business in Harford County.
 *
 * The geocoder is not wrong to offer it. Taking it is wrong. So a match has
 * to survive two questions before it is written down: is it anywhere near
 * where this business works, and does it actually resemble the address it was
 * asked about.
 */

/** Bel Air, near enough the middle of the county. Biases the search. */
export const HOME_POINT = { lat: 39.5359, lng: -76.3483 };

/**
 * How far out a client can plausibly be.
 *
 * Deliberately much wider than the county: real customers do live in Elkton
 * and Baltimore County and occasionally Ocean City, and a box drawn tight
 * around Harford would reject them. This is the box outside which a result is
 * not a distant customer but a mismatch — a different state, a different
 * country, a street name that exists in forty places.
 */
export const REGION = { south: 37.0, north: 41.5, west: -81.0, east: -74.0 };

export interface GeocodeMatch {
  fullAddress: string;
  lat: number;
  lng: number;
}

export type RejectReason =
  | "outside_region"
  | "different_state"
  | "different_country"
  | "different_zip";

export interface GuardVerdict {
  accepted: boolean;
  /** Why not, in words the office reads on the failed list. */
  reason: string | null;
  code: RejectReason | null;
}

/**
 * A point that cannot be a client of this business.
 *
 * Used on properties already on the map, not only on fresh lookups: the pins
 * in Toronto and Memphis were written before anything checked, and their
 * address text often looks fine — it is the coordinates that are wrong.
 */
export function pointOutsideRegion(
  lat: number | null | undefined,
  lng: number | null | undefined
): boolean {
  if (lat == null || lng == null) return false;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return false;
  // Null island is an unplaced row, not a misplaced one.
  if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) return false;
  return lat < REGION.south || lat > REGION.north || lng < REGION.west || lng > REGION.east;
}

function within(match: GeocodeMatch): boolean {
  return (
    match.lat >= REGION.south &&
    match.lat <= REGION.north &&
    match.lng >= REGION.west &&
    match.lng <= REGION.east
  );
}

/** Every state and province a match could plausibly name, spelled out. */
const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "district of columbia": "DC",
  ontario: "ON", quebec: "QC", "british columbia": "BC", alberta: "AB",
  manitoba: "MB", saskatchewan: "SK", "nova scotia": "NS", "new brunswick": "NB",
};

/** The codes, so "Rd" at the end of a street is not read as a state. */
const STATE_CODES = new Set(Object.values(STATE_NAMES));

/**
 * The state or province a written address names, as a two-letter code.
 *
 * Spelled-out names are matched longest first, so "west virginia" is not read
 * as "virginia". A bare two-letter code counts only when it is really a state
 * code — "8 Brooks Rd" ends in two letters and names no state at all, and
 * reading "Rd" as Rhode Island is how a Bel Air address gets rejected for
 * being in the wrong place.
 */
export function stateIn(address: string): string | null {
  const lower = address.toLowerCase();
  const names = Object.keys(STATE_NAMES).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) return STATE_NAMES[name];
  }

  const codes = address.toUpperCase().match(/\b[A-Z]{2}\b/g) ?? [];
  for (let i = codes.length - 1; i >= 0; i--) {
    if (STATE_CODES.has(codes[i])) return codes[i];
  }
  return null;
}

/** The ZIP a written address ends with, if it ends with one. */
export function zipIn(address: string): string | null {
  const match = address.trim().match(/\b(\d{5})(?:-\d{4})?\s*(?:,?\s*(?:usa|us|united states))?\s*$/i);
  return match ? match[1] : null;
}

/**
 * Whether a geocoder's answer can be believed for the address it was asked
 * about.
 *
 * The query is the evidence. Where it names a state or a ZIP, the answer has
 * to agree — an address that says Maryland and comes back Ontario is not a
 * near miss, it is a different place with a similar street name. Where the
 * query names nothing, the region box is all there is, and it is enough to
 * keep the map inside the world this business operates in.
 */
export function guardMatch(query: string, match: GeocodeMatch): GuardVerdict {
  if (/\bcanada\b/i.test(match.fullAddress) && !/\bcanada\b/i.test(query)) {
    return {
      accepted: false,
      code: "different_country",
      reason: "The lookup landed in Canada — the address needs a town and state on it.",
    };
  }

  const wantedZip = zipIn(query);
  const gotZip = zipIn(match.fullAddress);
  if (wantedZip && gotZip && wantedZip !== gotZip) {
    return {
      accepted: false,
      code: "different_zip",
      reason: `The lookup came back as ${gotZip}, not ${wantedZip}.`,
    };
  }

  const wantedState = stateIn(query);
  const gotState = stateIn(match.fullAddress);
  if (wantedState && gotState && wantedState !== gotState) {
    return {
      accepted: false,
      code: "different_state",
      reason: `The lookup came back in ${gotState}, not ${wantedState}.`,
    };
  }

  if (!within(match)) {
    return {
      accepted: false,
      code: "outside_region",
      reason: "The lookup landed a long way outside the area — check the address.",
    };
  }

  return { accepted: true, reason: null, code: null };
}

/**
 * The first answer worth having.
 *
 * Walks the geocoder's list rather than taking the top one: the best match
 * for a thin address is often the wrong country, and the second is the right
 * street in the right state.
 */
export function firstAcceptable(
  query: string,
  matches: GeocodeMatch[]
): { match: GeocodeMatch | null; reason: string | null } {
  if (matches.length === 0) return { match: null, reason: "No match for that address" };

  let firstReason: string | null = null;
  for (const match of matches) {
    const verdict = guardMatch(query, match);
    if (verdict.accepted) return { match, reason: null };
    if (!firstReason) firstReason = verdict.reason;
  }
  return { match: null, reason: firstReason };
}

/**
 * Whether an address is worth sending to a geocoder at all.
 *
 * A street with no town is the input that produces Ontario. Refusing it up
 * front costs one lookup and saves a pin nobody will notice is wrong until
 * they are looking at a map of North America.
 */
export function tooThinToPlace(address: string): boolean {
  const clean = address.trim();
  if (clean.length < 6) return true;
  // Something naming a place: a town after a comma, a state, or a ZIP.
  return !(clean.includes(",") || stateIn(clean) !== null || zipIn(clean) !== null);
}

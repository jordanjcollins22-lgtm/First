/**
 * Whether an address is in the county this business actually works in.
 *
 * Every lead should be in Harford County, Maryland. Ones that are not are
 * nearly always a bad address rather than a real customer three states away:
 * a geocoder that guessed, a town name that exists in forty states, a street
 * typed without its town. Those leads sit in the list looking real, and
 * somebody eventually drives to one.
 *
 * The checks are deliberately lopsided. Proving an address is OUTSIDE the
 * county is safe and useful; proving one is INSIDE is not something a ZIP and
 * a bounding box can honestly do, because the box overlaps Baltimore and
 * Cecil counties. So anything short of a clear answer is "unknown" and stays
 * off the list to check. A list of two hundred fine addresses is a list
 * nobody opens.
 */

export type CountyVerdict =
  /** Confidently in Harford County. */
  | "inside"
  /** Confidently not. Worth somebody looking at. */
  | "outside"
  /** Not enough in the address to say either way. */
  | "unknown";

export interface CountyCheck {
  verdict: CountyVerdict;
  /** What decided it, in words somebody can act on. */
  reason: string;
}

/** Every ZIP code in Harford County, Maryland. */
export const HARFORD_ZIPS = new Set([
  "21001", // Aberdeen
  "21005", // Aberdeen Proving Ground
  "21009", // Abingdon
  "21010", // Gunpowder
  "21013", // Baldwin (partly)
  "21014", // Bel Air
  "21015", // Bel Air
  "21017", // Belcamp
  "21018", // Benson
  "21028", // Churchville
  "21034", // Darlington
  "21040", // Edgewood
  "21047", // Fallston
  "21050", // Forest Hill
  "21078", // Havre de Grace
  "21084", // Jarrettsville
  "21085", // Joppa
  "21130", // Perryman
  "21132", // Pylesville
  "21154", // Street
  "21160", // Whiteford
  "21161", // White Hall (partly)
]);

/** Towns that are unambiguously in the county. */
const HARFORD_TOWNS = new Set([
  "aberdeen",
  "abingdon",
  "bel air",
  "belcamp",
  "churchville",
  "darlington",
  "edgewood",
  "fallston",
  "forest hill",
  "havre de grace",
  "jarrettsville",
  "joppa",
  "joppatowne",
  "perryman",
  "pylesville",
  "riverside",
  "street",
  "whiteford",
]);

/**
 * A box that comfortably contains the county and a margin around it.
 *
 * Used only to prove an address is outside. Inside the box means "could be
 * Harford, could be Baltimore County", which is not an answer.
 */
const BOUNDS = { south: 39.3, north: 39.75, west: -76.6, east: -75.95 };

/** Two-letter codes and names for every state that is not Maryland. */
const STATE_PATTERN =
  /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/;

function zipIn(address: string): string | null {
  const match = address.match(/\b(\d{5})(?:-\d{4})?\b/);
  return match ? match[1] : null;
}

/**
 * Whether a coordinate is real.
 *
 * Null island is what an ungeocoded row looks like, and calling it "outside
 * the county" would put every un-geocoded lead on the list to check.
 */
function usable(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (lat == null || lng == null) return false;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return false;
  return !(Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01);
}

export function checkHarford(input: {
  address: string;
  lat?: number | null;
  lng?: number | null;
}): CountyCheck {
  const address = (input.address ?? "").trim();
  if (!address) return { verdict: "unknown", reason: "No address on file" };

  const lower = address.toLowerCase();

  // A ZIP is the strongest thing a written address carries, so it is read
  // before anything else can contradict it.
  const zip = zipIn(address);
  if (zip) {
    if (HARFORD_ZIPS.has(zip)) return { verdict: "inside", reason: `ZIP ${zip}` };
    return { verdict: "outside", reason: `ZIP ${zip} is not in Harford County` };
  }

  // Coordinates next, because a geocoded point beats a town name that exists
  // in forty states.
  if (usable(input.lat, input.lng)) {
    const lat = input.lat as number;
    const lng = input.lng as number;
    if (lat < BOUNDS.south || lat > BOUNDS.north || lng < BOUNDS.west || lng > BOUNDS.east) {
      return { verdict: "outside", reason: "Map location is well outside the county" };
    }
  }

  // A named state that is not Maryland settles it.
  const state = address.toUpperCase().match(STATE_PATTERN);
  if (state && !/\bMD\b|maryland/i.test(address)) {
    return { verdict: "outside", reason: `Address says ${state[1]}` };
  }

  for (const town of HARFORD_TOWNS) {
    if (lower.includes(town)) return { verdict: "inside", reason: `In ${title(town)}` };
  }

  // Inside the box and nothing else to go on. Could be Harford, could be the
  // wrong side of the Baltimore County line, so it is not claimed either way.
  if (usable(input.lat, input.lng)) {
    return { verdict: "unknown", reason: "Near the county but no ZIP or town to confirm it" };
  }

  return { verdict: "unknown", reason: "No ZIP, town or map location to check" };
}

function title(value: string): string {
  return value.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Just the ones worth somebody's time. */
export function outOfArea<T extends { address: string; lat?: number | null; lng?: number | null }>(
  rows: T[]
): (T & { reason: string })[] {
  const flagged: (T & { reason: string })[] = [];
  for (const row of rows) {
    const check = checkHarford(row);
    if (check.verdict === "outside") flagged.push({ ...row, reason: check.reason });
  }
  return flagged;
}

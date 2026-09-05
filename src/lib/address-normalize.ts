/**
 * One physical address, written one way.
 *
 * This is the only join between a county parcel and a customer we already had.
 * The county writes "1628 EVA MAR BLVD"; the CRM holds "1628 Eva Mar Boulevard,
 * Bel Air, MD 21015, United States"; somebody typed "1628 eva mar blvd." into a
 * booking form. All three are one house, and the map is wrong in a different
 * way for each one it fails to see.
 *
 * The output is not for reading. It is a key: upper case, no punctuation,
 * USPS-style abbreviations, no country. Abbreviating rather than expanding
 * because there are more ways to write "Boulevard" than "BLVD", and the
 * canonical form should be the one with fewest spellings.
 *
 * Unit numbers are kept. Two flats at one street address are two doors, two
 * hangers and potentially two customers, and collapsing them would silently
 * merge households.
 *
 * Deliberately conservative. Anything this cannot confidently canonicalise
 * comes out as tidied text rather than a guess, and the caller sends it to a
 * human instead of merging on a hunch.
 *
 * It abbreviates street-type and compass words wherever they appear, including
 * inside street and town names: "Old Mountain Road" becomes "OLD MTN RD",
 * "North Canton" becomes "N CANTON". That is ugly and it is on purpose.
 *
 * The alternative is to abbreviate only the last word of the street line,
 * which reads better and requires knowing where the street line ends -- which
 * means relying on the commas. The CRM writes commas and a county feed may
 * not, so that version returns two different keys for one address depending on
 * its punctuation. A key that is uniformly ugly is worth more than a key that
 * is sometimes pretty and sometimes wrong, because the only job here is that
 * both sides of a match agree.
 */

/** USPS street suffixes, long form to the abbreviation we store. */
const SUFFIXES: Record<string, string> = {
  ALLEY: "ALY",
  AVENUE: "AVE",
  AV: "AVE",
  BOULEVARD: "BLVD",
  BOUL: "BLVD",
  CIRCLE: "CIR",
  CIRC: "CIR",
  COURT: "CT",
  COVE: "CV",
  CRESCENT: "CRES",
  CROSSING: "XING",
  DRIVE: "DR",
  DRV: "DR",
  EXPRESSWAY: "EXPY",
  EXTENSION: "EXT",
  FREEWAY: "FWY",
  GARDENS: "GDNS",
  GREEN: "GRN",
  GROVE: "GRV",
  HEIGHTS: "HTS",
  HIGHWAY: "HWY",
  HOLLOW: "HOLW",
  JUNCTION: "JCT",
  LANE: "LN",
  LOOP: "LOOP",
  MANOR: "MNR",
  MEADOWS: "MDWS",
  MOUNT: "MT",
  MOUNTAIN: "MTN",
  PARKWAY: "PKWY",
  PARKWY: "PKWY",
  PASS: "PASS",
  PATH: "PATH",
  PIKE: "PIKE",
  PLACE: "PL",
  PLAZA: "PLZ",
  POINT: "PT",
  RIDGE: "RDG",
  ROAD: "RD",
  ROUTE: "RTE",
  RUN: "RUN",
  SQUARE: "SQ",
  STREET: "ST",
  STR: "ST",
  TERRACE: "TER",
  TRACE: "TRCE",
  TRAIL: "TRL",
  TURNPIKE: "TPKE",
  VALLEY: "VLY",
  VIEW: "VW",
  VILLAGE: "VLG",
  WALK: "WALK",
  WAY: "WAY",
};

/** Compass words to their abbreviation, for both prefix and suffix position. */
const DIRECTIONS: Record<string, string> = {
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
  NORTHEAST: "NE",
  NORTHWEST: "NW",
  SOUTHEAST: "SE",
  SOUTHWEST: "SW",
};

/** Unit designators, standardised but never dropped. */
const UNITS: Record<string, string> = {
  APARTMENT: "APT",
  APT: "APT",
  UNIT: "UNIT",
  SUITE: "STE",
  STE: "STE",
  BUILDING: "BLDG",
  BLDG: "BLDG",
  FLOOR: "FL",
  FL: "FL",
  ROOM: "RM",
  RM: "RM",
  LOT: "LOT",
  TRAILER: "TRLR",
};

const STATES: Record<string, string> = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA",
  COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE", FLORIDA: "FL", GEORGIA: "GA",
  HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA",
  KANSAS: "KS", KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD",
  MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN", MISSISSIPPI: "MS",
  MISSOURI: "MO", MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV",
  "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY",
  "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", OHIO: "OH", OKLAHOMA: "OK",
  OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT", VERMONT: "VT",
  VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV", WISCONSIN: "WI",
  WYOMING: "WY", "DISTRICT OF COLUMBIA": "DC",
};

/** Trailing country names, which carry no information here. */
const COUNTRIES = ["UNITED STATES OF AMERICA", "UNITED STATES", "USA", "US"];

function stripCountry(text: string): string {
  for (const country of COUNTRIES) {
    if (text.endsWith(` ${country}`)) return text.slice(0, -(country.length + 1));
  }
  return text;
}

function expandStates(text: string): string {
  // Longest first, so "WEST VIRGINIA" is not eaten by "VIRGINIA".
  const names = Object.keys(STATES).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const pattern = new RegExp(`(^|\\s)${name}(\\s|$)`, "g");
    if (pattern.test(text)) return text.replace(pattern, `$1${STATES[name]}$2`);
  }
  return text;
}

/**
 * The canonical form of an address, or "" for something unusable.
 *
 * Empty rather than a best guess, because an empty key matches nothing while a
 * guessed key matches the wrong house.
 */
export function normalizeAddress(raw: string | null | undefined): string {
  if (!raw) return "";

  let text = raw.toUpperCase();

  // A ZIP+4 is the same house as its ZIP.
  text = text.replace(/(\d{5})-\d{4}\b/g, "$1");
  // "#12" is a unit number; the hash carries nothing the word does not.
  text = text.replace(/#\s*/g, "UNIT ");
  // Commas and full stops are punctuation everywhere in an address.
  text = text.replace(/[.,]/g, " ");
  // Everything else that is not a letter, digit, space or hyphen.
  text = text.replace(/[^A-Z0-9\s-]/g, " ");
  text = text.replace(/\s+/g, " ").trim();

  text = stripCountry(text);
  text = expandStates(text);

  const words = text.split(" ").filter(Boolean);
  const out = words.map((word, i) => {
    // Never touch the first word: "1 NORTH ST" has a house number, and
    // "NORTH ST" starts with a street name that happens to be a direction.
    if (i === 0) return word;
    return SUFFIXES[word] ?? DIRECTIONS[word] ?? UNITS[word] ?? word;
  });

  return out.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Whether two addresses are certainly the same house.
 *
 * Certainty is the whole point: this is what may link automatically. Anything
 * it refuses goes to a person, and refusing too often costs a review while
 * accepting too often puts a stranger's name on a proposal.
 */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeAddress(a);
  return left !== "" && left === normalizeAddress(b);
}

/**
 * How alike two addresses are, 0 to 1, for ranking a review queue.
 *
 * Not a decision. A score exists so a person sees the closest candidate first,
 * and 1 here still means "identical once normalised" rather than "safe to
 * merge without looking" -- though callers may treat a 1 as automatic, which
 * is exactly what sameAddress does.
 */
export function addressSimilarity(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  const left = normalizeAddress(a);
  const right = normalizeAddress(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftWords = new Set(left.split(" "));
  const rightWords = new Set(right.split(" "));
  let shared = 0;
  for (const word of leftWords) if (rightWords.has(word)) shared++;

  // Jaccard: shared words over all distinct words. Crude, and right for the
  // job -- the failure it has to catch is a missing ZIP or a spelled-out
  // suffix, both of which leave most words intact.
  const union = new Set([...leftWords, ...rightWords]).size;
  return Math.round((shared / union) * 100) / 100;
}

/**
 * The house number, when the address starts with one.
 *
 * Used to refuse a match outright: 1628 and 1638 Eva Mar Blvd share every
 * other word and are two different families.
 */
export function houseNumber(raw: string | null | undefined): string | null {
  const normalized = normalizeAddress(raw);
  const first = normalized.split(" ")[0] ?? "";
  return /^\d+[A-Z]?$/.test(first) ? first : null;
}

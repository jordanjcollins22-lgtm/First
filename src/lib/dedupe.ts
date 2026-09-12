/**
 * Recognising the same person or place written two different ways.
 *
 * Duplicates get in because the same record arrives by more than one door: a
 * client books online with their email, then someone types them in by name
 * from a phone call. Matching on the raw text misses that, so everything is
 * normalised to a comparison key first.
 *
 * Pure functions on purpose — they're the part worth testing, and they run the
 * same way on the server actions and the public booking flow.
 */

/** Lowercase, strip punctuation, collapse runs of whitespace. */
function squash(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,'"`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeName(name: string | null | undefined): string {
  return squash(name ?? "");
}

/** Digits only, with the US country code dropped so +1 410… and 410… match. */
export function normalizePhone(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

// The abbreviations people actually vary on when typing an address. Written
// long-form → short so both spellings land on the same key.
const STREET_WORDS: Record<string, string> = {
  street: "st",
  avenue: "ave",
  road: "rd",
  drive: "dr",
  lane: "ln",
  court: "ct",
  circle: "cir",
  boulevard: "blvd",
  parkway: "pkwy",
  highway: "hwy",
  place: "pl",
  terrace: "ter",
  trail: "trl",
  square: "sq",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
};

// Unit designators are dropped entirely so "#2", "Apt 2", and "Unit 2" all
// reduce to the same key. The number itself is kept — that's what tells two
// homes apart.
const UNIT_WORDS = new Set(["apartment", "apt", "suite", "ste", "unit", "number", "no"]);

/**
 * A comparison key for a street address.
 *
 * Deliberately keeps unit numbers: 12 Main St Apt 2 and Apt 3 are different
 * homes, and merging them would be worse than leaving a duplicate.
 */
export function normalizeAddress(address: string | null | undefined): string {
  const base = squash(address ?? "").replace(/#/g, " ");
  return base
    .split(" ")
    .filter((word) => !UNIT_WORDS.has(word))
    .map((word) => STREET_WORDS[word] ?? word)
    .filter(Boolean)
    .join(" ");
}

export interface CustomerLike {
  id: string;
  name: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface IncomingCustomer {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

/**
 * The existing customer this entry is really about, or null for someone new.
 *
 * Email and phone come first — they identify a person, while two people can
 * genuinely share a name. A name-only match is accepted last because in a
 * business this size "Mike Johnson" twice is far more often one person typed
 * twice than two clients.
 */
export function findDuplicateCustomer(
  existing: CustomerLike[],
  incoming: IncomingCustomer
): CustomerLike | null {
  const email = normalizeEmail(incoming.email);
  const phone = normalizePhone(incoming.phone);
  const name = normalizeName(incoming.name);

  if (email) {
    const hit = existing.find((c) => normalizeEmail(c.email) === email);
    if (hit) return hit;
  }
  // Seven digits would match across area codes; require a full number.
  if (phone.length >= 10) {
    const hit = existing.find((c) => normalizePhone(c.phone) === phone);
    if (hit) return hit;
  }
  if (name) {
    const hit = existing.find((c) => normalizeName(c.name) === name);
    if (hit) return hit;
  }
  return null;
}

export interface PropertyLike {
  id: string;
  address: string | null;
}

export function findDuplicateProperty(
  existing: PropertyLike[],
  address: string
): PropertyLike | null {
  const key = normalizeAddress(address);
  if (!key) return null;
  return existing.find((p) => normalizeAddress(p.address) === key) ?? null;
}

/**
 * Fields worth copying onto the record we're keeping.
 *
 * Only fills blanks. Overwriting a value that's already there would let a
 * half-filled booking form wipe a phone number somebody rang the office to
 * correct — that's data loss wearing a merge's clothing.
 */
export function mergeableFields<T extends Record<string, string | null | undefined>>(
  existing: T,
  incoming: T
): { [K in keyof T]?: NonNullable<T[K]> } {
  // Values are only ever set from a non-empty string, so the result never
  // carries a null — saying so keeps it assignable to non-nullable columns.
  const patch: { [K in keyof T]?: NonNullable<T[K]> } = {};
  for (const key of Object.keys(incoming) as (keyof T)[]) {
    const incomingValue = incoming[key];
    const existingValue = existing[key];
    const hasIncoming = typeof incomingValue === "string" && incomingValue.trim() !== "";
    const hasExisting = typeof existingValue === "string" && existingValue.trim() !== "";
    if (hasIncoming && !hasExisting) patch[key] = incomingValue as NonNullable<T[typeof key]>;
  }
  return patch;
}

/**
 * Turning county parcels into houses without wrecking the ones we have.
 *
 * The importer's whole job is deciding, for one parcel, which of three things
 * is true: we already have this house and the county is telling us more about
 * it; we have never seen it and it should exist; or it is close enough to
 * something we have that guessing would be worse than asking.
 *
 * Getting the first one wrong is the expensive mistake. A house carries the
 * evaluations, the proposals and the money; a second row for the same address
 * silently splits that history in half and neither half is right afterwards.
 * So a link is only ever made on exact equality of the normalized address, and
 * everything short of that becomes a question.
 *
 * Coordinates take no part in any of it. They are the half that was wrong.
 */

import { addressSimilarity, houseNumber, normalizeAddress } from "@/lib/address-normalize";
import { assessAddress, canLinkAutomatically, type AddressKind } from "@/lib/address-quality";

/** One parcel, after the county's own field names have been mapped away. */
export interface ParcelRecord {
  /** The county's stable key for this parcel. */
  parcelId: string;
  /** The county's own address text. */
  address: string;
  lat: number | null;
  lng: number | null;
  ownerName: string | null;
  lotSizeSqft: number | null;
}

/** The little a decision needs to know about a house we already hold. */
export interface ExistingHouse {
  id: string;
  normalizedAddress: string | null;
}

export type ImportDecision =
  /** We have this house. Add what the county knows; change nothing else. */
  | { action: "enrich"; houseId: string; normalized: string }
  /** New ground. */
  | { action: "create"; normalized: string; kind: AddressKind }
  /** Close to something we hold. A person decides. */
  | { action: "review"; normalized: string; candidateHouseId: string; score: number; reason: string }
  /** Not a house. Nothing is created, because the county has many of these. */
  | { action: "skip"; reason: string };

/**
 * How alike two addresses must be before a difference is worth asking about.
 *
 * Below this they are simply different places and the parcel is new ground.
 */
const AMBIGUOUS_AT = 0.8;

/**
 * What to do with one parcel.
 *
 * The order matters. Unusable parcels leave before anything is matched, an
 * exact key wins outright, and only what survives both is measured for
 * closeness -- so a near-match can never overrule a house we are certain of.
 */
export function resolveParcel(parcel: ParcelRecord, existing: ExistingHouse[]): ImportDecision {
  const normalized = normalizeAddress(parcel.address);
  const verdict = assessAddress(parcel.address, { lat: parcel.lat, lng: parcel.lng });

  // A county feed carries rights of way, common ground and unaddressed lots.
  // Creating a held house for each would bury the review queue in things
  // nobody will ever knock on.
  if (verdict.kind !== "house") {
    return { action: "skip", reason: verdict.reasons[0] ?? "Not a single house" };
  }

  const exact = existing.find((house) => canLinkAutomatically(house.normalizedAddress, normalized));
  if (exact) return { action: "enrich", houseId: exact.id, normalized };

  // Nothing matched exactly. Anything close enough to be the same house is a
  // question rather than a new row.
  const number = houseNumber(parcel.address);
  let best: { house: ExistingHouse; score: number } | null = null;

  for (const house of existing) {
    // A different house number is a different house, however alike the rest
    // reads. 1628 and 1638 Eva Mar Blvd share every other word.
    if (houseNumber(house.normalizedAddress) !== number) continue;

    const score = addressSimilarity(house.normalizedAddress, normalized);
    if (score >= AMBIGUOUS_AT && (!best || score > best.score)) best = { house, score };
  }

  if (best) {
    return {
      action: "review",
      normalized,
      candidateHouseId: best.house.id,
      score: best.score,
      reason: `Close to an address already held, but not identical`,
    };
  }

  return { action: "create", normalized, kind: verdict.kind };
}

/**
 * Which of the county's fields is which.
 *
 * Discovered at run time rather than written down, because a county renaming a
 * column should cost a re-run and not a deploy. Candidates are tried in order
 * and the first one the layer actually has wins.
 */
export const FIELD_CANDIDATES = {
  parcelId: ["ACCTID", "ACCOUNT", "ACCTNUM", "PARCELID", "PARCEL_ID", "PIN", "OBJECTID"],
  address: ["SITUS_ADDRESS", "SITUSADDR", "ADDRESS", "PROPADDR", "FULLADDR", "SITEADDRESS", "ADDR"],
  ownerName: ["OWNNAME", "OWNER", "OWNER_NAME", "OWNERNAME", "DEEDHOLDER"],
  lotSizeSqft: ["SQFT", "LOTSIZE", "LOT_SIZE", "AREA", "ACRES"],
} as const;

export type FieldRole = keyof typeof FIELD_CANDIDATES;

/**
 * Picks the field to read for one role, from what the layer reports it has.
 *
 * Case-insensitive, because ArcGIS layers are inconsistent about it and a
 * mapping that fails on capitalisation is a mapping that fails silently.
 * Returns null rather than a guess: a missing address field should stop an
 * import, not import ten thousand houses with no address.
 */
export function pickField(available: string[], role: FieldRole): string | null {
  const byUpper = new Map(available.map((name) => [name.toUpperCase(), name]));
  for (const candidate of FIELD_CANDIDATES[role]) {
    const found = byUpper.get(candidate);
    if (found) return found;
  }
  return null;
}

export interface FieldMapping {
  parcelId: string | null;
  address: string | null;
  ownerName: string | null;
  lotSizeSqft: string | null;
}

/** The whole mapping, and whether it is usable. */
export function discoverFields(available: string[]): FieldMapping {
  return {
    parcelId: pickField(available, "parcelId"),
    address: pickField(available, "address"),
    ownerName: pickField(available, "ownerName"),
    lotSizeSqft: pickField(available, "lotSizeSqft"),
  };
}

/**
 * Whether a mapping is enough to import with.
 *
 * An address is the identity, so without one there is nothing to import. A
 * parcel id is wanted and not required: it makes refreshes cheaper, and its
 * absence is not a reason to refuse the county's addresses.
 */
export function mappingIsUsable(mapping: FieldMapping): boolean {
  return Boolean(mapping.address);
}

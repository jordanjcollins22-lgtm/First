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
  parcelId: [
    "ACCTID",
    "ACCOUNT",
    "ACCTNUM",
    "PARCELID",
    "PARCEL_ID",
    "PIN",
    "ADDRESSID",
    "ADDRESS_ID",
    "ADDR_ID",
    "GLOBALID",
    "OBJECTID",
  ],
  address: [
    "SITUS_ADDRESS",
    "SITUSADDR",
    "FULLADDR",
    "FULL_ADDRESS",
    "FULLADDRESS",
    "SITEADDRESS",
    "SITE_ADDRESS",
    "PROPADDR",
    "ADDRESS",
    "ADDR",
    "STREET_ADDRESS",
    "PREMADDR",
  ],
  ownerName: ["OWNNAME", "OWNNAME1", "OWNER", "OWNER_NAME", "OWNERNAME", "DEEDHOLDER"],
  lotSizeSqft: ["SQFT", "LOTSIZE", "LOT_SIZE", "LAND_AREA", "ACRES", "AREA"],
  // P_Z_1 and P_CITY are what Harford's Address Master actually calls them,
  // learned from the layer itself on the first live connection test.
  zip: ["ZIPCODE", "ZIP", "ZIP_CODE", "P_Z_1", "POSTAL", "POSTALCODE", "POSTAL_CODE", "SITUS_ZIP", "PREMZIP", "ZIP1"],
  city: ["CITY", "P_CITY", "MUNICIPALITY", "POSTAL_CITY", "SITUS_CITY", "PLACE", "TOWN", "PREMCITY", "MSAGCOMM"],
  state: ["STATE", "ST", "SITUS_STATE", "STATEABBR", "P_STATE"],
  landUse: ["DESCLU", "LU", "LANDUSE", "LAND_USE", "USECODE", "USE_CODE", "PROPTYPE", "ZONING"],
  // A door inside a building. Two apartments at one street address are two
  // houses to knock on, and without the unit they would collapse into one.
  unit: ["UNITNUMBER", "UNIT_NUMBER", "UNITNUM", "UNIT_NUM", "UNIT", "APT", "SUBADDRESS"],
  unitType: ["UNITTYPE", "UNIT_TYPE", "SUBADDRESS_TYPE"],
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

export type FieldMapping = Record<FieldRole, string | null>;

/** The whole mapping, and whether it is usable. */
export function discoverFields(available: string[]): FieldMapping {
  const mapping = {} as FieldMapping;
  for (const role of Object.keys(FIELD_CANDIDATES) as FieldRole[]) {
    mapping[role] = pickField(available, role);
  }
  return mapping;
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

/** Reads one attribute as text, or nothing. Numbers are text too: a ZIP can arrive as 21014. */
function text(attributes: Record<string, unknown>, field: string | null): string | null {
  if (!field) return null;
  const value = attributes[field];
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function numeric(attributes: Record<string, unknown>, field: string | null): number | null {
  if (!field) return null;
  const value = attributes[field];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/**
 * Words in a land-use description that mean nobody lives there.
 *
 * Kept short and negative on purpose. A land-use field is an extra: when the
 * layer has none, or says something we do not recognise, the parcel goes on to
 * the address check like any other. Only a description that plainly says
 * commercial, industrial, or empty ground is turned away here.
 */
const NOT_RESIDENTIAL = /commerc|industr|agricult|exempt|utilit|vacant|open space|right.of.way|parking|church|school|government|cemeter|railroad|common area|conservation/i;
const RESIDENTIAL = /resid|dwelling|town ?house|condo|apartment|single|multi.?fam|duplex|mobile home|manufactured/i;

/** Whether a land-use description rules a parcel out as somewhere to knock. */
export function landUseLooksResidential(landUse: string | null): boolean {
  if (!landUse) return true;
  if (RESIDENTIAL.test(landUse)) return true;
  return !NOT_RESIDENTIAL.test(landUse);
}

/**
 * The county's address as one line, however many columns it came in.
 *
 * Some layers carry "1550 SWEARINGEN DR" in one field and the town and ZIP in
 * two others; the normalizer wants all of it, because a key without a ZIP
 * cannot tell two Bel Airs apart. State defaults to Maryland when the layer
 * has no column for it, since this is Harford County's own data.
 */
export function assembleAddress(
  attributes: Record<string, unknown>,
  mapping: FieldMapping
): string | null {
  let street = text(attributes, mapping.address);
  if (!street) return null;

  // The unit, when the layer keeps it in its own column and the street line
  // does not already carry one.
  const unit = text(attributes, mapping.unit);
  if (unit && !/\b(APT|UNIT|STE|SUITE|BLDG|LOT|#)\s*\S+/i.test(street)) {
    const unitType = text(attributes, mapping.unitType) ?? "UNIT";
    street = `${street} ${unitType} ${unit}`;
  }

  const city = text(attributes, mapping.city);
  const state = text(attributes, mapping.state) ?? "MD";
  const zip = text(attributes, mapping.zip);

  // Already a full address: the street field carries a town or a ZIP.
  if (/\b\d{5}(-\d{4})?\b/.test(street) || (city && street.toUpperCase().includes(city.toUpperCase()))) {
    return street;
  }

  const tail = [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return tail ? `${street}, ${tail}` : street;
}

export interface MappedParcel {
  parcel: ParcelRecord | null;
  /** Why there is no parcel, when there is none. */
  skipReason: string | null;
  /** The county's land-use text, for the record. */
  landUse: string | null;
}

/**
 * One feature, read through the discovered mapping.
 *
 * Nothing here decides identity. It produces the parcel record the resolver
 * judges, and says no when the feature is not a place anyone lives.
 */
export function parcelFromFeature(
  feature: { attributes: Record<string, unknown>; lat: number | null; lng: number | null },
  mapping: FieldMapping,
  fallbackId: string
): MappedParcel {
  const landUse = text(feature.attributes, mapping.landUse);
  if (!landUseLooksResidential(landUse)) {
    return { parcel: null, skipReason: `Land use: ${landUse}`, landUse };
  }

  const address = assembleAddress(feature.attributes, mapping);
  if (!address) return { parcel: null, skipReason: "No address on the feature", landUse };

  const lot = numeric(feature.attributes, mapping.lotSizeSqft);
  // An acreage field is small numbers; a square-footage field is large ones.
  const lotSizeSqft =
    lot == null ? null : /ACRE/i.test(mapping.lotSizeSqft ?? "") ? Math.round(lot * 43_560) : Math.round(lot);

  return {
    parcel: {
      parcelId: text(feature.attributes, mapping.parcelId) ?? fallbackId,
      address,
      lat: feature.lat,
      lng: feature.lng,
      ownerName: text(feature.attributes, mapping.ownerName),
      lotSizeSqft,
    },
    skipReason: null,
    landUse,
  };
}

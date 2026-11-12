import { normalizeAddress } from "@/lib/address-normalize";
import { discoverSdatFields, premiseOf, type SdatMapping } from "@/lib/sdat";
import { sqlLiteral } from "@/lib/arcgis";
import { LEAD_FINDER_ZIPS, rankParcel, type FinderCategory } from "@/lib/lead-finder";

/**
 * Reading commercial, church, HOA and apartment parcels out of the State's
 * assessment roll for the lead finder.
 *
 * The roll's own reader (sdat.ts) maps the fields and builds the address;
 * this adds what the finder needs on top: the lot size, the point, which
 * kind of property it is, and a where clause that asks the portal for only
 * the non-residential parcels in our ZIPs, a few thousand rows rather than
 * the county's hundred thousand.
 *
 * Owners are kept only when they are organizations. A commercial lot owned
 * by a person is still worth a look, but the person's name and mailing
 * address are not ours to keep; the finder stores "billed out of state" and
 * nothing else about them.
 */

export interface FinderMapping extends SdatMapping {
  acres?: string;
  landArea?: string;
  landUnit?: string;
  lat?: string;
  lng?: string;
  point?: string;
}

const EXTRA: Record<"acres" | "landArea" | "landUnit" | "lat" | "lng" | "point", string[]> = {
  acres: ["ACRES", "LAND_AREA_ACRES", "ACREAGE", "GIS_ACRES", "CALC_ACRES"],
  landArea: ["LANDAREA", "LAND_AREA", "C_A_M_A_SYSTEM_DATA_LAND_AREA", "LOT_SIZE"],
  landUnit: ["LUOM", "LAND_UNIT_OF_MEASURE", "LAND_AREA_UNIT", "C_A_M_A_SYSTEM_DATA_LAND_UNIT_OF_MEASURE", "UNIT_OF_MEASURE"],
  lat: ["MDP_LATITUDE", "LATITUDE", "LAT", "Y_COORD"],
  lng: ["MDP_LONGITUDE", "LONGITUDE", "LON", "LNG", "LONG", "X_COORD"],
  point: ["LOCATION", "GEOCODED_COLUMN", "MDP_LOCATION", "THE_GEOM", "POINT"],
};

/** The roll's mapping plus the finder's extra fields, matched the same way (exact, then portal-suffixed). */
export function discoverFinderFields(names: string[]): FinderMapping {
  const mapping: FinderMapping = discoverSdatFields(names);
  const upper = names.map((n) => [n.toUpperCase(), n] as const);
  const byUpper = new Map(upper);
  for (const key of Object.keys(EXTRA) as (keyof typeof EXTRA)[]) {
    for (const candidate of EXTRA[key]) {
      const exact = byUpper.get(candidate);
      if (exact) {
        mapping[key] = exact;
        break;
      }
      const prefixed = upper.find(([u]) => u.startsWith(candidate) && /^(_MDP_FIELD|_SDAT_FIELD)/.test(u.slice(candidate.length)));
      if (prefixed) {
        mapping[key] = prefixed[1];
        break;
      }
    }
  }
  return mapping;
}

/* ------------------------------------------------------------ who owns it */

const CHURCH = /\b(CHURCH|PARISH|CONGREGATION|MINISTR(Y|IES)|DIOCESE|ARCHBISHOP|ARCHDIOCESE|FELLOWSHIP|TEMPLE|SYNAGOGUE|MOSQUE|BAPTIST|METHODIST|LUTHERAN|PRESBYTER(Y|IAN)|CATHOLIC|EPISCOPAL|TABERNACLE|ASSEMBLY OF GOD|KINGDOM HALL|CHAPEL|EVANGELICAL|AME\b|ZION)\b/;
const HOA = /\b(HOMEOWNERS?|HOME OWNERS|COMMUNITY ASS(OCIATION|N|OC)|HOA|CONDOMINIUM|COUNCIL OF (UNIT )?OWNERS|MAINTENANCE CORP|OPEN SPACE|TOWNHOME ASS|IMPROVEMENT ASS)/;
const GOVERNMENT = /\b(HARFORD COUNTY|COUNTY COMMISSIONERS|BOARD OF (EDUCATION|COUNTY)|STATE OF MARYLAND|STATE HIGHWAY|UNITED STATES|USA\b|TOWN OF|MAYOR AND|COMMISSIONERS OF|MARYLAND TRANSPORTATION|HOUSING AUTHORITY|MD ENVIRONMENTAL|MARYLAND ENVIRONMENTAL|BALTIMORE GAS|BGE\b|VERIZON|RAILROAD|COMCAST)/;
const ORGANIZATION = /\b(L\.?L\.?C|INC|INCORPORATED|CORP|CORPORATION|COMPANY|CO|L\.?P|LLP|LTD|PLLC|PC|ASSOCIATES|ASSOCIATION|ASSN|ASSOC|PARTNERS(HIP)?|HOLDINGS?|PROPERTIES|PROPERTY|REALTY|REAL ESTATE|APARTMENTS?|BANK|FOUNDATION|SCHOOL|ACADEMY|CLUB|LODGE|POST|LEGION|VFW|GROUP|ENTERPRISES?|VENTURES?|INVESTMENTS?|INVESTORS|DEVELOPMENT|DEVELOPERS|MANAGEMENT|CENTER|CENTRE|PLAZA|STORAGE|LIMITED|FUND|REIT|COUNCIL|SOCIETY|HOSPITAL|HEALTH|MEDICAL|SERVICES)\b/;

function upper(s: string | null | undefined): string {
  return (s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
}

/** Whether an owner name is an organization rather than a person. A personal trust is a person. */
export function isOrganizationName(owner: string | null | undefined): boolean {
  const u = upper(owner);
  if (!u) return false;
  if (/\b(REVOCABLE|LIVING|FAMILY|IRREVOCABLE) TRUST\b|\bTRUSTEES?\b|\bESTATE OF\b|\bLIFE ESTATE\b/.test(u) && !CHURCH.test(u)) return false;
  return CHURCH.test(u) || HOA.test(u) || GOVERNMENT.test(u) || ORGANIZATION.test(u);
}

export function isGovernmentOwner(owner: string | null | undefined): boolean {
  return GOVERNMENT.test(upper(owner));
}

/** SDAT land-use codes and what they mean for the finder (null = not a prospect on its own). */
const LAND_USE_CODES: Record<string, FinderCategory | "exempt" | null> = {
  C: "commercial",
  CC: "commercial",
  CR: "commercial",
  EC: "commercial",
  I: "industrial",
  M: "apartments",
  E: "exempt",
  R: null,
  RC: null,
  TH: null,
  U: null,
  A: null,
};

/** The land-use code from "C", "Commercial (C)" or "C - Commercial". */
export function landUseCode(value: string | null | undefined): string | null {
  const u = upper(value);
  if (!u) return null;
  if (/^[A-Z]{1,2}$/.test(u)) return u;
  const paren = /\(([A-Z]{1,2})\)/.exec(u);
  if (paren) return paren[1];
  const lead = /^([A-Z]{1,2})\s*[-:]\s/.exec(u);
  return lead ? lead[1] : null;
}

/**
 * What kind of prospect a parcel is, or null when it is not one: homes,
 * farms, government land. The owner speaks first (a church or an HOA owns
 * land the roll may call residential or exempt), then the land use.
 */
export function classifyParcel(landUse: string | null | undefined, owner: string | null | undefined): FinderCategory | null {
  const o = upper(owner);
  if (o && GOVERNMENT.test(o)) return null;
  if (o && CHURCH.test(o)) return "church";
  if (o && HOA.test(o)) return "hoa";

  const u = upper(landUse);
  const code = landUseCode(u);
  let kind: FinderCategory | "exempt" | null | undefined = code ? LAND_USE_CODES[code] : undefined;
  if (kind === undefined) {
    if (/APARTMENT|MULTI ?FAMILY/.test(u)) kind = "apartments";
    else if (/EXEMPT/.test(u)) kind = /COMMERCIAL/.test(u) ? "commercial" : "exempt";
    else if (/INDUSTRIAL/.test(u)) kind = "industrial";
    else if (/COMMERCIAL|RETAIL|OFFICE/.test(u)) kind = "commercial";
    else kind = null;
  }
  if (kind === "exempt") return o && isOrganizationName(o) ? "institution" : null;
  if (kind === "apartments" || kind === "commercial" || kind === "industrial") return kind;
  return null;
}

/* ------------------------------------------------------------ the request */

const LAND_USE_WORDS = ["COMMERCIAL", "EXEMPT", "INDUSTRIAL", "APARTMENT"];
const LAND_USE_LIST = ["C", "CC", "CR", "E", "EC", "I", "M"];
const OWNER_WORDS = ["CHURCH", "PARISH", "CONGREGATION", "HOMEOWNER", "HOME OWNERS", "COMMUNITY ASS", "CONDOMINIUM", "COUNCIL OF UNIT", "APARTMENT"];

/**
 * The where clause for the finder's pull: Harford, our ZIPs, and either a
 * non-residential land use or an owner that names itself a church, HOA or
 * apartment company. Written in the subset of SQL both the open-data portal
 * (SoQL) and an ArcGIS layer accept: upper(), like, in, and, or.
 */
export function finderWhere(mapping: FinderMapping, zips: readonly string[] = LEAD_FINDER_ZIPS): string {
  const parts: string[] = [];
  if (mapping.county) parts.push(`upper(${mapping.county}) like 'HARFORD%'`);
  if (mapping.zip && zips.length > 0) parts.push(`(${zips.map((z) => `${mapping.zip} like ${sqlLiteral(`${z}%`)}`).join(" or ")})`);

  const kinds: string[] = [];
  for (const field of [mapping.landUse, mapping.landUseDescription]) {
    if (!field) continue;
    kinds.push(`upper(${field}) in (${LAND_USE_LIST.map((c) => `'${c}'`).join(",")})`);
    for (const w of LAND_USE_WORDS) kinds.push(`upper(${field}) like '%${w}%'`);
  }
  if (mapping.ownerName) for (const w of OWNER_WORDS) kinds.push(`upper(${mapping.ownerName}) like '%${w}%'`);
  if (kinds.length > 0) parts.push(`(${kinds.join(" or ")})`);
  return parts.join(" and ") || "1=1";
}

/** The columns the finder reads, so a page of a thousand rows does not carry two hundred columns each. */
export function finderSelect(mapping: FinderMapping): string[] {
  return [...new Set(Object.values(mapping).filter((v): v is string => typeof v === "string" && v.length > 0))];
}

/* ------------------------------------------------------------ one row */

export interface FinderParcel {
  sourceKey: string;
  name: string;
  category: FinderCategory;
  address: string;
  addressKey: string;
  city: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  landUse: string | null;
  acreage: number | null;
  assessedValue: number | null;
  /** Organizations only. */
  ownerName: string | null;
  /** Organizations only: where the tax bill goes, which for a managed property is the manager. */
  ownerMailing: string | null;
  ownerState: string | null;
  priority: number;
}

function text(attrs: Record<string, unknown>, field: string | undefined): string | null {
  if (!field) return null;
  const v = attrs[field];
  if (v == null || typeof v === "object") return null;
  const s = String(v).trim();
  return s || null;
}

function number(attrs: Record<string, unknown>, field: string | undefined): number | null {
  const s = text(attrs, field);
  if (s == null) return null;
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Lot size in acres: the acres column when there is one, else the land area by its unit. */
export function acreageOf(attrs: Record<string, unknown>, mapping: FinderMapping): number | null {
  const acres = number(attrs, mapping.acres);
  if (acres != null) return Math.round(acres * 1000) / 1000;
  const area = number(attrs, mapping.landArea);
  if (area == null) return null;
  const unit = upper(text(attrs, mapping.landUnit));
  // SDAT writes A for acres and S for square feet. With no unit, anything
  // over a thousand is square feet: no lot in Harford is a thousand acres.
  const isSqft = unit.startsWith("S") || (!unit.startsWith("A") && area > 1000);
  const value = isSqft ? area / 43_560 : area;
  return Math.round(value * 1000) / 1000;
}

/** The parcel's point: latitude and longitude columns, a portal point column, or the feature's centroid. */
export function pointOf(attrs: Record<string, unknown>, mapping: FinderMapping, fallback?: { lat: number | null; lng: number | null }): { lat: number; lng: number } | null {
  const ok = (lat: number | null, lng: number | null) =>
    lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && lat !== 0 && lng !== 0 ? { lat, lng } : null;
  const asNum = (v: unknown) => (v == null || v === "" ? null : Number(v));

  const direct = ok(asNum(mapping.lat ? attrs[mapping.lat] : null), asNum(mapping.lng ? attrs[mapping.lng] : null));
  if (direct) return direct;

  const point = mapping.point ? attrs[mapping.point] : null;
  if (point && typeof point === "object") {
    const p = point as { coordinates?: unknown; latitude?: unknown; longitude?: unknown };
    if (Array.isArray(p.coordinates)) {
      const found = ok(asNum(p.coordinates[1]), asNum(p.coordinates[0]));
      if (found) return found;
    }
    const found = ok(asNum(p.latitude), asNum(p.longitude));
    if (found) return found;
  }
  return fallback ? ok(fallback.lat, fallback.lng) : null;
}

/** "ST IGNATIUS CHURCH INC" → "St Ignatius Church Inc". Keeps short all-caps words like LLC. */
export function titleCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b([a-z])([a-z']*)/g, (_, a: string, b: string) => a.toUpperCase() + b)
    .replace(/\b(Llc|Lp|Llp|Inc|Hoa|Ame|Pc|Pllc|Usa)\b/g, (w) => (w === "Inc" ? "Inc" : w.toUpperCase()));
}

/**
 * One row of the roll as a finder parcel, or null when it is not a prospect
 * (a home, a farm, government land) or has no address to go and look at.
 */
export function finderParcelFromRecord(
  attrs: Record<string, unknown>,
  mapping: FinderMapping,
  fallbackPoint?: { lat: number | null; lng: number | null }
): FinderParcel | null {
  const owner = [text(attrs, mapping.ownerName), text(attrs, mapping.ownerName2)].filter(Boolean).join(" & ") || null;
  const landUse = text(attrs, mapping.landUseDescription) ?? text(attrs, mapping.landUse);
  const category = classifyParcel(text(attrs, mapping.landUse) ?? landUse, owner) ?? classifyParcel(landUse, owner);
  if (!category) return null;

  const premise = premiseOf(attrs, mapping);
  if (!premise || !/^\d/.test(premise)) return null;
  const city = text(attrs, mapping.city);
  const zipRaw = text(attrs, mapping.zip);
  const zip = zipRaw ? zipRaw.replace(/\D/g, "").slice(0, 5) || null : null;
  const addressKey = normalizeAddress([premise, city, zip ? `MD ${zip}` : "MD"].filter(Boolean).join(", "));
  if (!addressKey) return null;

  const isOrg = isOrganizationName(owner);
  const mailState = text(attrs, mapping.mailState)?.toUpperCase().slice(0, 2) ?? null;
  const ownerMailing = isOrg
    ? [text(attrs, mapping.mailLine1), text(attrs, mapping.mailLine2), [text(attrs, mapping.mailCity), mailState, text(attrs, mapping.mailZip)?.slice(0, 5)].filter(Boolean).join(" ")]
        .filter((s) => s && s.trim())
        .join(", ")
        .replace(/\s+/g, " ")
        .trim() || null
    : null;
  const acreage = acreageOf(attrs, mapping);
  const assessedValue = number(attrs, mapping.assessedValue);
  const point = pointOf(attrs, mapping, fallbackPoint);
  const account = text(attrs, mapping.account);
  const name = isOrg && owner ? titleCase(owner) : `${titleCase(premise)}`;

  return {
    sourceKey: account ? `sdat:${account.replace(/\s+/g, "")}` : `sdat:${addressKey}`,
    name,
    category,
    address: titleCase(premise),
    addressKey,
    city: city ? titleCase(city) : null,
    zip,
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    landUse,
    acreage,
    assessedValue: assessedValue != null ? Math.round(assessedValue) : null,
    ownerName: isOrg && owner ? titleCase(owner) : null,
    ownerMailing,
    ownerState: mailState,
    priority: rankParcel({ category, acreage, ownerState: mailState, name: isOrg ? owner : null, assessedValue }),
  };
}

/** Two accounts on one address (a condo, a split lot) are one place to look at: the bigger lot wins. */
export function dedupeParcels(parcels: FinderParcel[]): FinderParcel[] {
  const byKey = new Map<string, FinderParcel>();
  for (const p of parcels) {
    const seen = byKey.get(p.addressKey);
    if (!seen || (p.acreage ?? 0) > (seen.acreage ?? 0)) byKey.set(p.addressKey, p);
  }
  return [...byKey.values()];
}

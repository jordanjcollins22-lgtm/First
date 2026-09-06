import { normalizeAddress } from "@/lib/address-normalize";

/**
 * Reading the State's assessment roll.
 *
 * Maryland's SDAT parcel data comes through MD iMAP as an ArcGIS layer with
 * one point per account. The field names have varied across its releases,
 * so like the county import this reads whatever the layer says it has and
 * maps by candidates, recording the mapping on the job. From one record:
 * the premise address (to find our house), the owner and where the bill
 * goes (to tell owner-occupied from absentee), the principal-residence
 * flag, the last transfer and its price.
 *
 * Pure: records in, ownership facts out.
 */

export const DEFAULT_SDAT_URL =
  "https://geodata.md.gov/imap/rest/services/PlanningCadastre/MD_PropertyData/MapServer/0";

export type SdatKey =
  | "account"
  | "address"
  | "streetNumber"
  | "streetName"
  | "unit"
  | "city"
  | "zip"
  | "ownerName"
  | "ownerName2"
  | "mailLine1"
  | "mailLine2"
  | "mailCity"
  | "mailState"
  | "mailZip"
  | "principalResidence"
  | "transferDate"
  | "consideration"
  | "yearBuilt"
  | "landUse"
  | "landUseDescription"
  | "assessedValue"
  | "jurisdiction"
  | "county";

export type SdatMapping = Partial<Record<SdatKey, string>>;

const CANDIDATES: Record<SdatKey, string[]> = {
  account: ["ACCTID", "ACCOUNT_ID", "ACCT_ID", "ACCOUNTID", "ACCOUNT"],
  address: ["ADDRESS", "PREMISE_ADDRESS", "PREM_ADDR", "SITE_ADDR", "MDP_STREET_ADDRESS", "PREMADDR", "SITEADDR"],
  streetNumber: ["STRTNUM", "PREMISE_ADDRESS_NUMBER", "STREET_NUMBER", "HOUSE_NUMBER"],
  streetName: ["STRTNAM", "PREMISE_ADDRESS_STREET", "STREET_NAME"],
  unit: ["STRTUNT", "PREMISE_ADDRESS_UNIT", "UNIT"],
  city: ["CITY", "PREMISE_ADDRESS_CITY", "MDP_CITY", "PREMCITY", "SITE_CITY"],
  zip: ["ZIPCODE", "PREMISE_ADDRESS_ZIP", "ZIP", "PREMZIP", "SITE_ZIP", "MDP_ZIP"],
  ownerName: ["OWNNAME1", "OWNER_NAME", "OWNNAME", "OWNER_NAME_1", "OWNER1"],
  ownerName2: ["OWNNAME2", "OWNER_NAME_2", "OWNER2"],
  mailLine1: ["OWNADD1", "OWNER_MAILING_ADDRESS_LINE_1", "MAIL_ADDR1", "MAILADDR1", "OWNER_ADDRESS_1"],
  mailLine2: ["OWNADD2", "OWNER_MAILING_ADDRESS_LINE_2", "MAIL_ADDR2", "MAILADDR2", "OWNER_ADDRESS_2"],
  mailCity: ["OWNCITY", "OWNER_CITY", "MAIL_CITY", "MAILCITY"],
  mailState: ["OWNSTA", "OWNER_STATE", "MAIL_STATE", "MAILSTATE"],
  mailZip: ["OWNZIP", "OWNER_ZIP", "MAIL_ZIP", "MAILZIP"],
  principalResidence: ["RESIDENT", "PRINCIPAL_RESIDENCE", "PRINRES", "PRIN_RES", "HOMESTEAD", "OWNOCC"],
  transferDate: ["TRADATE", "SALES_SEGMENT_1_TRANSFER_DATE", "TRANSFER_DATE", "LAST_SALE_DATE", "SALEDATE", "TRANSFER_DATE_1"],
  consideration: ["CONSIDR1", "SALES_SEGMENT_1_CONSIDERATION", "CONSIDERATION", "SALE_PRICE", "SALEPRICE", "CONSIDERATION_1"],
  yearBuilt: ["YEARBLT", "YEAR_BUILT", "YRBLT"],
  landUse: ["LU", "LAND_USE", "LAND_USE_CODE", "LUCODE"],
  landUseDescription: ["DESCLU", "LAND_USE_DESCRIPTION", "LU_DESC"],
  assessedValue: ["NFMTTLVL", "TOTAL_ASSESSMENT", "ASSESSMENT", "CURRENT_ASSESSMENT", "NFMTTL"],
  jurisdiction: ["JURSCODE", "JURISDICTION_CODE", "JURIS", "JURSCD"],
  county: ["COUNTY", "COUNTY_NAME", "CNTYNAME", "JURISDICTION"],
};

/** Which of the layer's fields carry what. Names are matched case-insensitively. */
export function discoverSdatFields(names: string[]): SdatMapping {
  const byUpper = new Map(names.map((n) => [n.toUpperCase(), n]));
  const mapping: SdatMapping = {};
  for (const key of Object.keys(CANDIDATES) as SdatKey[]) {
    for (const candidate of CANDIDATES[key]) {
      const hit = byUpper.get(candidate);
      if (hit) {
        mapping[key] = hit;
        break;
      }
    }
  }
  return mapping;
}

/** Whether the mapping can find a house at all. */
export function sdatMappingIsUsable(mapping: SdatMapping): boolean {
  return Boolean(mapping.address || (mapping.streetNumber && mapping.streetName));
}

/** Harford's codes in the State's data: the jurisdiction code, and the county's name. */
export const HARFORD_JURISDICTION = "HARF";
export const HARFORD_COUNTY = "HARFORD";

/**
 * The where clause that keeps the request to Harford. The State layer is
 * the whole of Maryland, two and a half million points; asked without a
 * filter it would take the afternoon. By jurisdiction code when the layer
 * has one, by county name when it has that, by our ZIPs otherwise.
 */
export function sdatWhere(mapping: SdatMapping, zips: string[], zipIsNumber = false): string {
  if (mapping.jurisdiction) return `${mapping.jurisdiction} = '${HARFORD_JURISDICTION}'`;
  if (mapping.county) return `UPPER(${mapping.county}) LIKE '${HARFORD_COUNTY}%'`;
  if (mapping.zip && zips.length > 0) {
    const list = zips.map((z) => (zipIsNumber ? String(Number(z)) : `'${z}'`)).join(",");
    return `${mapping.zip} IN (${list})`;
  }
  return "1=1";
}

export interface OwnershipRecord {
  accountId: string | null;
  /** The premise address as the roll has it, one line. */
  premise: string;
  /** Our house key for it. */
  normalized: string;
  ownerName: string | null;
  ownerMailing: string | null;
  ownerOccupied: boolean | null;
  occupancyReason: string | null;
  principalResidence: boolean | null;
  lastSaleDate: string | null;
  lastSalePrice: number | null;
  yearBuilt: number | null;
  landUse: string | null;
  assessedValue: number | null;
}

function text(attrs: Record<string, unknown>, field: string | undefined): string | null {
  if (!field) return null;
  const value = attrs[field];
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function integer(attrs: Record<string, unknown>, field: string | undefined): number | null {
  const s = text(attrs, field);
  if (s == null) return null;
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n !== 0 ? Math.round(n) : null;
}

/**
 * A date as the roll writes it: "20240315", "2024-03-15", "03/15/2024", or
 * epoch milliseconds, as ArcGIS sends date fields. To ISO, or nothing.
 */
export function parseSdatDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (value <= 0) return null;
    const ms = value < 1e11 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) || d.getFullYear() < 1800 ? null : d.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  let m = /^(\d{4})(\d{2})(\d{2})/.exec(s);
  if (m) return check(m[1], m[2], m[3]);
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return check(m[1], m[2], m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return check(m[3], m[1].padStart(2, "0"), m[2].padStart(2, "0"));
  if (/^\d{12,13}$/.test(s)) return parseSdatDate(Number(s));
  return null;
}

function check(y: string, mo: string, d: string): string | null {
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (year < 1800 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${mo}-${d}`;
}

/** The principal-residence flag, in the several ways the roll spells it. */
export function parsePrincipalResidence(value: unknown): boolean | null {
  if (value == null) return null;
  const s = String(value).trim().toUpperCase();
  if (!s) return null;
  if (s === "Y" || s === "YES" || s === "TRUE" || s === "1" || s === "H" || s.startsWith("PRINCIPAL")) return true;
  if (s === "N" || s === "NO" || s === "FALSE" || s === "0" || s.startsWith("NOT")) return false;
  return null;
}

/** The premise address, one line, from whichever fields the layer has. */
export function premiseOf(attrs: Record<string, unknown>, mapping: SdatMapping): string | null {
  let line = text(attrs, mapping.address);
  if (!line) {
    const number = text(attrs, mapping.streetNumber);
    const street = text(attrs, mapping.streetName);
    if (!number || !street) return null;
    line = `${number} ${street}`;
  }
  const unit = text(attrs, mapping.unit);
  if (unit && !/\b(APT|UNIT|STE|SUITE|BLDG|LOT|#)\s*\S+/i.test(line)) line = `${line} UNIT ${unit}`;
  return line.replace(/\s+/g, " ").trim();
}

/** The house number and street of an address line, for telling two apart. */
export function streetKeyOf(line: string | null): string {
  if (!line) return "";
  const normalized = normalizeAddress(line);
  // The number and the first two words are enough to say "same street"; the
  // roll abbreviates one way and the county another.
  return normalized.split(" ").slice(0, 3).join(" ");
}

/**
 * Owner-occupied or not, and why, from where the tax bill goes and what the
 * owner told the State.
 *
 * The mailing address is the stronger signal: a homestead claim lags a
 * purchase by a year, and a landlord's bill goes to the landlord. So: bill
 * mailed to the house is owner-occupied; mailed elsewhere is absentee; no
 * mailing address on the roll, the principal-residence flag decides.
 */
export function occupancyOf(
  premise: string,
  premiseZip: string | null,
  mail: { line1: string | null; line2: string | null; city: string | null; state: string | null; zip: string | null },
  principalResidence: boolean | null
): { ownerOccupied: boolean | null; reason: string | null; mailing: string | null } {
  const mailing = [mail.line1, mail.line2, [mail.city, mail.state, mail.zip ? mail.zip.slice(0, 5) : null].filter(Boolean).join(" ")]
    .filter((s) => s && s.trim())
    .join(", ")
    .replace(/\s+/g, " ")
    .trim();
  const premiseKey = streetKeyOf(premise);
  const mailKey = streetKeyOf(mail.line1) || streetKeyOf(mail.line2);

  if (mailKey && premiseKey) {
    if (mailKey === premiseKey) return { ownerOccupied: true, reason: "Tax bill goes to the house", mailing: mailing || null };
    const sameZip = premiseZip && mail.zip && premiseZip.slice(0, 5) === mail.zip.slice(0, 5);
    return {
      ownerOccupied: false,
      reason: `Tax bill goes to ${mailing}${sameZip ? "" : ""}`,
      mailing: mailing || null,
    };
  }
  if (principalResidence === true) return { ownerOccupied: true, reason: "Owner claims it as principal residence", mailing: mailing || null };
  if (principalResidence === false) return { ownerOccupied: false, reason: "Not the owner's principal residence", mailing: mailing || null };
  return { ownerOccupied: null, reason: null, mailing: mailing || null };
}

/** One record of the roll, read. Nothing when it has no address we could match. */
export function ownershipFromRecord(attrs: Record<string, unknown>, mapping: SdatMapping): OwnershipRecord | null {
  const premise = premiseOf(attrs, mapping);
  if (!premise) return null;
  const city = text(attrs, mapping.city);
  const zipRaw = text(attrs, mapping.zip);
  const zip = zipRaw ? zipRaw.replace(/\D/g, "").slice(0, 5) : null;
  const normalized = normalizeAddress([premise, city, zip ? `MD ${zip}` : "MD"].filter(Boolean).join(", "));
  if (!normalized) return null;

  const principalResidence = parsePrincipalResidence(mapping.principalResidence ? attrs[mapping.principalResidence] : null);
  const occupancy = occupancyOf(
    premise,
    zip,
    {
      line1: text(attrs, mapping.mailLine1),
      line2: text(attrs, mapping.mailLine2),
      city: text(attrs, mapping.mailCity),
      state: text(attrs, mapping.mailState),
      zip: text(attrs, mapping.mailZip),
    },
    principalResidence
  );
  const owner = [text(attrs, mapping.ownerName), text(attrs, mapping.ownerName2)].filter(Boolean).join(" & ") || null;

  return {
    accountId: text(attrs, mapping.account),
    premise,
    normalized,
    ownerName: owner,
    ownerMailing: occupancy.mailing,
    ownerOccupied: occupancy.ownerOccupied,
    occupancyReason: occupancy.reason,
    principalResidence,
    lastSaleDate: parseSdatDate(mapping.transferDate ? attrs[mapping.transferDate] : null),
    lastSalePrice: integer(attrs, mapping.consideration),
    yearBuilt: integer(attrs, mapping.yearBuilt),
    landUse: text(attrs, mapping.landUseDescription) ?? text(attrs, mapping.landUse),
    assessedValue: integer(attrs, mapping.assessedValue),
  };
}

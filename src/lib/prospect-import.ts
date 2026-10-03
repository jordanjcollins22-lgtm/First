/**
 * Turning a list of properties into prospects.
 *
 * The sources this is built for are the ones a business can legitimately use:
 * public county and state property records (Maryland SDAT and Harford County
 * publish parcel exports), lists bought from a vendor, and the RentCast
 * account the app already pays for. All of them arrive as CSV or JSON, so the
 * work is parsing and column mapping rather than crawling.
 *
 * It deliberately does not scrape listing sites or social platforms. Those
 * prohibit it in their terms, and a lead list that can get the business sued
 * isn't worth having.
 *
 * Pure functions — the parsing and mapping is the part that goes wrong, so
 * it's the part that's tested.
 */

import { normalizeAddress } from "@/lib/dedupe";

export interface ProspectDraft {
  ownerName: string | null;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  acreage: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  assessedValue: number | null;
  phone: string | null;
  email: string | null;
  /** Normalised address, used to dedupe against contacts and other imports. */
  addressKey: string;
}

export interface ImportReport {
  drafts: ProspectDraft[];
  /** Rows that couldn't be used, with the reason, so nothing fails silently. */
  skipped: { row: number; reason: string }[];
  /** Headers found in the file but not recognised — surfaced so a column the
   * business cares about isn't quietly dropped. */
  unmappedHeaders: string[];
}

/** A minimal RFC-4180 reader: handles quoted fields, escaped quotes, and
 * newlines inside quotes, which county exports do contain. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * Header names seen across Maryland SDAT exports, county parcel downloads, and
 * the common list vendors. Matching is loose — punctuation and spacing vary
 * between every export.
 */
const COLUMN_ALIASES: Record<keyof Omit<ProspectDraft, "addressKey">, string[]> = {
  ownerName: ["owner", "owner name", "ownername", "owner 1", "owner1", "ownr name", "deed owner"],
  address: [
    "address",
    "property address",
    "propertyaddress",
    "site address",
    "situs address",
    "street address",
    "premise address",
    "location",
  ],
  city: ["city", "property city", "situs city", "town"],
  state: ["state", "property state", "situs state", "st"],
  zip: ["zip", "zipcode", "zip code", "postal code", "property zip"],
  acreage: [
    "acres",
    "acreage",
    "lot acres",
    "lot size acres",
    "land acres",
    "deed acres",
    // Ambiguous units — acresFrom sorts out square feet from acres.
    "lot size",
    "lot size sqft",
    "lot sqft",
    "land sqft",
    "land area",
  ],
  sqft: ["sqft", "square feet", "living area", "building sqft", "structure sqft", "finished area"],
  yearBuilt: ["year built", "yearbuilt", "yr built", "construction year"],
  assessedValue: ["assessed value", "total assessment", "assessment", "market value", "total value"],
  phone: ["phone", "phone number", "primary phone", "telephone", "mobile"],
  email: ["email", "email address", "primary email"],
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[_\-.]/g, " ").replace(/\s+/g, " ").trim();
}

function toNumber(value: string | undefined): number | null {
  if (!value) return null;
  // Strips $ and thousands separators, which assessment columns always carry.
  const cleaned = value.replace(/[$,]/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toText(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/** Some exports give lot size in square feet rather than acres. */
const SQFT_PER_ACRE = 43_560;

function acresFrom(value: string | undefined, header: string): number | null {
  const n = toNumber(value);
  if (n == null) return null;
  // A "lot size" column reading 21780 is square feet, not 21,780 acres.
  if (header.includes("sqft") || header.includes("square")) return n / SQFT_PER_ACRE;
  return n > 1000 ? n / SQFT_PER_ACRE : n;
}

export function mapRows(rows: string[][]): ImportReport {
  const skipped: { row: number; reason: string }[] = [];
  const drafts: ProspectDraft[] = [];

  if (rows.length < 2) {
    return { drafts, skipped: [{ row: 0, reason: "No rows found in the file." }], unmappedHeaders: [] };
  }

  const headers = rows[0].map(normalizeHeader);
  const columnFor: Partial<Record<keyof Omit<ProspectDraft, "addressKey">, number>> = {};
  const usedIndexes = new Set<number>();

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as [
    keyof Omit<ProspectDraft, "addressKey">,
    string[],
  ][]) {
    const index = headers.findIndex((h) => aliases.includes(h));
    if (index >= 0) {
      columnFor[field] = index;
      usedIndexes.add(index);
    }
  }

  const unmappedHeaders = headers.filter((h, i) => h !== "" && !usedIndexes.has(i));

  if (columnFor.address === undefined) {
    return {
      drafts,
      skipped: [{ row: 0, reason: "No address column found. Expected a header like 'Address' or 'Property Address'." }],
      unmappedHeaders,
    };
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const address = toText(row[columnFor.address]);
    if (!address) {
      skipped.push({ row: i + 1, reason: "No address" });
      continue;
    }

    const addressKey = normalizeAddress(address);
    if (!addressKey) {
      skipped.push({ row: i + 1, reason: "Address didn't parse" });
      continue;
    }

    const acreageHeader = columnFor.acreage !== undefined ? headers[columnFor.acreage] : "";

    drafts.push({
      ownerName: columnFor.ownerName !== undefined ? toText(row[columnFor.ownerName]) : null,
      address,
      city: columnFor.city !== undefined ? toText(row[columnFor.city]) : null,
      state: columnFor.state !== undefined ? toText(row[columnFor.state]) : null,
      zip: columnFor.zip !== undefined ? toText(row[columnFor.zip]) : null,
      acreage: columnFor.acreage !== undefined ? acresFrom(row[columnFor.acreage], acreageHeader) : null,
      sqft: columnFor.sqft !== undefined ? toNumber(row[columnFor.sqft]) : null,
      yearBuilt: columnFor.yearBuilt !== undefined ? toNumber(row[columnFor.yearBuilt]) : null,
      assessedValue: columnFor.assessedValue !== undefined ? toNumber(row[columnFor.assessedValue]) : null,
      phone: columnFor.phone !== undefined ? toText(row[columnFor.phone]) : null,
      email: columnFor.email !== undefined ? toText(row[columnFor.email]) : null,
      addressKey,
    });
  }

  return { drafts, skipped, unmappedHeaders };
}

export function importCsv(text: string): ImportReport {
  return mapRows(parseCsv(text));
}

/** Drops rows that repeat an address already in the same file. */
export function dedupeDrafts(drafts: ProspectDraft[]): { unique: ProspectDraft[]; duplicates: number } {
  const seen = new Set<string>();
  const unique: ProspectDraft[] = [];
  let duplicates = 0;

  for (const draft of drafts) {
    if (seen.has(draft.addressKey)) {
      duplicates++;
      continue;
    }
    seen.add(draft.addressKey);
    unique.push(draft);
  }

  return { unique, duplicates };
}

export interface TargetFilter {
  minAcreage: number | null;
  zips: string[];
  /** Only rows whose owner name is present — a blank owner usually means a
   * commercial parcel or a record the export didn't fill in. */
  requireOwner: boolean;
}

/** Narrows an import to the homes actually worth targeting. */
export function applyTargetFilter(drafts: ProspectDraft[], filter: TargetFilter): ProspectDraft[] {
  return drafts.filter((draft) => {
    if (filter.minAcreage != null && (draft.acreage == null || draft.acreage < filter.minAcreage)) return false;
    if (filter.zips.length > 0 && (!draft.zip || !filter.zips.includes(draft.zip.trim()))) return false;
    if (filter.requireOwner && !draft.ownerName) return false;
    return true;
  });
}

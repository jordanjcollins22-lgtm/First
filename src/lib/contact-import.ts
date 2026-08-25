/**
 * Turning a CRM export into contacts.
 *
 * Built for GoHighLevel's contact export, which is where this business's
 * people actually live, but the column matching is loose enough for any CRM
 * that exports a name, an email and a phone.
 *
 * The type of contact is chosen per import rather than guessed from the data.
 * A row that says "Bob's Tree Service" is obviously a subcontractor to a
 * human and indistinguishable from a client to a parser, and filing the stone
 * yard as a customer is the mistake this whole feature exists to prevent. So
 * the person doing the import filters in the CRM, exports that group, and says
 * what it is — which is both more accurate than any heuristic and takes them
 * about ten seconds.
 *
 * Pure functions: parsing and column mapping is the part that goes wrong, so
 * it is the part that is tested.
 */

import { parseCsv } from "@/lib/prospect-import";
import { normalizeEmail, normalizePhone } from "@/lib/dedupe";

export interface ContactDraft {
  name: string;
  email: string | null;
  phone: string | null;
  /** As it arrived. Geocoded later, if ever — a partial address is still worth
   * keeping, and a property row needs a real point. */
  address: string | null;
  tags: string[];
  source: string | null;
  /** The CRM's own id, so re-importing updates instead of duplicating. */
  externalId: string | null;
  /** Opted out at the CRM. The one field that must survive the journey. */
  doNotContact: boolean;
  notes: string | null;
  /** What the CRM had them at, verbatim. Deliberately not mapped onto this
   * app's own stages: a stage named in somebody else's system means what they
   * meant by it, and guessing is how a won deal becomes an open one. */
  pipeline: string | null;
  pipelineStage: string | null;
  opportunityValue: number | null;
}

export interface ContactImportReport {
  drafts: ContactDraft[];
  skipped: { row: number; reason: string }[];
  /** Headers in the file that nothing claimed, so a column carrying something
   * important is visible rather than silently dropped. */
  unmatchedHeaders: string[];
}

/**
 * GoHighLevel's own header names first, then the variants other CRMs use.
 *
 * Matching is loose because punctuation and casing vary between every export
 * and between GHL's own screens.
 */
const COLUMN_ALIASES = {
  firstName: ["first name", "firstname", "first"],
  lastName: ["last name", "lastname", "last", "surname"],
  fullName: ["name", "full name", "fullname", "contact name", "display name"],
  email: ["email", "email address", "primary email", "e mail"],
  phone: ["phone", "phone number", "primary phone", "mobile", "mobile phone", "telephone", "cell"],
  address: ["address", "address 1", "address1", "street address", "full address", "street"],
  city: ["city", "town"],
  state: ["state", "province", "region"],
  zip: ["postal code", "postalcode", "zip", "zip code", "zipcode"],
  tags: ["tags", "tag", "labels"],
  source: ["source", "lead source", "contact source", "attribution source"],
  externalId: ["contact id", "contactid", "id", "external id"],
  dnd: ["dnd", "do not disturb", "do not contact", "unsubscribed", "opted out", "email opt out"],
  notes: ["notes", "note", "additional notes", "description"],
  pipeline: ["pipeline", "pipeline name", "opportunity pipeline"],
  pipelineStage: ["stage", "pipeline stage", "opportunity stage", "status", "deal stage"],
  opportunityValue: [
    "opportunity value",
    "lead value",
    "value",
    "deal value",
    "monetary value",
    "amount",
  ],
} as const;

type Field = keyof typeof COLUMN_ALIASES;

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[_\-.]/g, " ").replace(/\s+/g, " ").trim();
}

function toText(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Whether a CRM's opt-out column is saying yes.
 *
 * Exports write this half a dozen ways and the cost of reading it wrong is
 * contacting somebody who asked not to be, so anything that is not plainly
 * false counts as opted out. Erring towards silence is the only safe
 * direction here.
 */
function readOptOut(value: string | undefined): boolean {
  const text = (value ?? "").trim().toLowerCase();
  if (!text) return false;
  return !["false", "0", "no", "n", "off", "null"].includes(text);
}

/** Strips the currency symbol and thousands separators every CRM writes. */
function readMoney(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** GHL exports tags as a comma or semicolon separated list in one cell. */
function readTags(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Joins whatever address parts the export carried.
 *
 * Kept as one string rather than separate columns because it is going to a
 * geocoder, and a geocoder wants a line of text. A row with only a city is
 * still worth keeping — it will not resolve to a property, but it tells
 * somebody where this contact roughly is.
 */
function joinAddress(parts: (string | null)[]): string | null {
  const joined = parts.filter((p) => p && p.length > 0).join(", ");
  return joined.length > 0 ? joined : null;
}

export function parseContactCsv(text: string): ContactImportReport {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return {
      drafts: [],
      skipped: [{ row: 0, reason: "That file has no rows under its header." }],
      unmatchedHeaders: [],
    };
  }

  const headers = rows[0].map(normalizeHeader);
  const columnFor: Partial<Record<Field, number>> = {};
  const claimed = new Set<number>();

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as [Field, readonly string[]][]) {
    const index = headers.findIndex((h) => aliases.includes(h));
    if (index >= 0) {
      columnFor[field] = index;
      claimed.add(index);
    }
  }

  const unmatchedHeaders = rows[0].filter((_, i) => !claimed.has(i)).filter((h) => h.trim().length > 0);

  const hasName = columnFor.fullName !== undefined || columnFor.firstName !== undefined;
  if (!hasName && columnFor.email === undefined && columnFor.phone === undefined) {
    return {
      drafts: [],
      skipped: [
        {
          row: 0,
          reason: "No name, email or phone column found. Check this is a contact export.",
        },
      ],
      unmatchedHeaders,
    };
  }

  const drafts: ContactDraft[] = [];
  const skipped: ContactImportReport["skipped"] = [];
  const seen = new Set<string>();

  const cell = (row: string[], field: Field) =>
    columnFor[field] !== undefined ? toText(row[columnFor[field] as number]) : null;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every((c) => !c || !c.trim())) continue;

    const first = cell(row, "firstName");
    const last = cell(row, "lastName");
    const full = cell(row, "fullName");
    const name = full ?? [first, last].filter(Boolean).join(" ").trim();

    const email = cell(row, "email");
    const phone = cell(row, "phone");

    if (!name && !email && !phone) {
      skipped.push({ row: i, reason: "No name, email or phone" });
      continue;
    }

    // Within one file, the same person twice is one contact. Keyed on the
    // strongest identifier present so a repeated row with a typo'd name still
    // collapses.
    const key =
      cell(row, "externalId") ?? normalizeEmail(email) ?? normalizePhone(phone) ?? name.toLowerCase();
    if (key && seen.has(key)) {
      skipped.push({ row: i, reason: "Same contact appears earlier in this file" });
      continue;
    }
    if (key) seen.add(key);

    drafts.push({
      // A contact with no name but a phone is a real record; calling it
      // "Unknown" is better than dropping somebody's number.
      name: name || email || (phone as string),
      email,
      phone,
      address: joinAddress([cell(row, "address"), cell(row, "city"), cell(row, "state"), cell(row, "zip")]),
      tags: readTags(columnFor.tags !== undefined ? row[columnFor.tags] : undefined),
      source: cell(row, "source"),
      externalId: cell(row, "externalId"),
      doNotContact: readOptOut(columnFor.dnd !== undefined ? row[columnFor.dnd] : undefined),
      notes: cell(row, "notes"),
      pipeline: cell(row, "pipeline"),
      pipelineStage: cell(row, "pipelineStage"),
      opportunityValue: readMoney(cell(row, "opportunityValue")),
    });
  }

  return { drafts, skipped, unmatchedHeaders };
}

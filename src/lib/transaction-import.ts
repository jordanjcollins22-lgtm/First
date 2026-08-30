/**
 * A payments export, read back in.
 *
 * The money already happened somewhere else. What this is for is joining it
 * back up: which client paid, when, and what it was for, so a job stops
 * sitting in the pipeline as unpaid work when the money landed in March.
 *
 * Reading a file this app did not write means guessing at column names, and
 * the guessing is done here in one place with a list of aliases rather than
 * in the action. Every export calls the same four things by a different name,
 * and a column nothing claimed is reported rather than silently dropped so
 * that a mis-read file is visible before it is three hundred wrong rows.
 */

import { parseCsv } from "@/lib/prospect-import";

export interface TransactionDraft {
  /** The exporting system's own id. The stable key a re-import upserts on, so
   * running the same file twice does not pay everybody twice. */
  externalId: string | null;
  /** Whatever the file called the payer. Matched against contacts later. */
  name: string | null;
  email: string | null;
  phone: string | null;
  amountCents: number;
  /** ISO date. Null when the file's date could not be read, which is worth
   * seeing rather than quietly filing under today. */
  paidOn: string | null;
  /** succeeded, refunded, failed or pending, normalised from whatever the
   * file said. Only a settled one is money we actually have. */
  status: TransactionStatus;
  /** What it was for, where the export carries it. */
  description: string | null;
  method: string | null;
}

export type TransactionStatus = "succeeded" | "refunded" | "failed" | "pending" | "unknown";

export interface TransactionReport {
  drafts: TransactionDraft[];
  skipped: { row: number; reason: string }[];
  /** Columns nothing claimed, so a file carrying something this does not read
   * says so instead of losing it. */
  unmatchedHeaders: string[];
}

const COLUMN_ALIASES = {
  externalId: [
    "transaction id",
    "id",
    "payment id",
    "charge id",
    "reference",
    "reference number",
    "receipt number",
    "invoice id",
    "order id",
  ],
  name: ["name", "customer", "customer name", "contact", "contact name", "billing name", "payer"],
  email: ["email", "customer email", "billing email", "contact email", "email address"],
  phone: ["phone", "customer phone", "billing phone", "contact phone", "phone number"],
  amount: [
    "amount",
    "total",
    "amount paid",
    "paid",
    "gross",
    "gross amount",
    "subtotal",
    "price",
    "value",
    "converted amount",
  ],
  date: [
    "date",
    "created",
    "created at",
    "created date",
    "paid at",
    "payment date",
    "transaction date",
    "date paid",
    "completed at",
  ],
  status: ["status", "payment status", "state", "result"],
  description: ["description", "product", "item", "line item", "notes", "memo", "product name"],
  method: ["method", "payment method", "type", "payment type", "source", "card brand"],
} as const;

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[_\-.]/g, " ").replace(/\s+/g, " ").trim();
}

function text(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Money, from whatever the column held.
 *
 * Exports write the same twelve hundred dollars as "1200", "$1,200.00" and
 * "(1,200.00)" when it is a refund. Parsed to cents rather than a float,
 * because a total built by adding floats is a total that is wrong by pennies
 * in a way nobody can find.
 */
export function parseMoneyCents(value: string | undefined): number | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;

  const negative = /^\(.*\)$/.test(raw) || raw.startsWith("-");
  const digits = raw.replace(/[()]/g, "").replace(/[^0-9.]/g, "");
  if (!digits) return null;

  const asNumber = Number(digits);
  if (!Number.isFinite(asNumber)) return null;

  const cents = Math.round(asNumber * 100);
  return negative ? -cents : cents;
}

/**
 * The date, as an ISO day.
 *
 * Deliberately gives back null rather than today when it cannot read one. A
 * payment filed under the day it was imported is worse than one with no date:
 * the wrong date looks like an answer.
 */
export function parseDate(value: string | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;

  // Already an ISO day or timestamp.
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // Month/day/year, which is what a US export writes.
  const us = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * What the file's status word means for the money.
 *
 * Only "succeeded" is money we have. A refund is money we had and gave back,
 * which belongs on the record but must never mark a job paid, and a failed
 * one is not a payment at all.
 */
export function normaliseStatus(value: string | undefined): TransactionStatus {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return "unknown";

  // The not-money answers are checked first, and the money one uses word
  // boundaries. "unpaid" contains "paid", and reading it as money received is
  // the mistake that marks an unpaid job settled.
  if (/refund|returned|charge ?back|reversed/.test(raw)) return "refunded";
  if (/fail|declin|error|void|cancel|expired/.test(raw)) return "failed";
  if (/pending|processing|unpaid|outstanding|awaiting|\bdue\b|\bopen\b/.test(raw)) return "pending";
  if (/\b(succeed|succeeded|success|paid|complete|completed|captured|settled|approved|won)\b/.test(raw)) {
    return "succeeded";
  }
  return "unknown";
}

/** Money we actually have, and which may move a job forward. */
export function isSettled(draft: TransactionDraft): boolean {
  return draft.status === "succeeded" && draft.amountCents > 0;
}

export function parseTransactionCsv(csvText: string): TransactionReport {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    return { drafts: [], skipped: [{ row: 0, reason: "That file has no rows in it." }], unmatchedHeaders: [] };
  }

  const headers = rows[0].map(normalizeHeader);
  const index: Partial<Record<keyof typeof COLUMN_ALIASES, number>> = {};
  const claimed = new Set<number>();

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as [
    keyof typeof COLUMN_ALIASES,
    readonly string[],
  ][]) {
    const found = headers.findIndex((h) => aliases.includes(h));
    if (found >= 0) {
      index[field] = found;
      claimed.add(found);
    }
  }

  const unmatchedHeaders = rows[0]
    .filter((_, i) => !claimed.has(i))
    .filter((h) => h.trim().length > 0);

  const drafts: TransactionDraft[] = [];
  const skipped: { row: number; reason: string }[] = [];

  const cell = (row: string[], field: keyof typeof COLUMN_ALIASES) => {
    const at = index[field];
    return at === undefined ? undefined : row[at];
  };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every((c) => !c.trim())) continue;

    const amountCents = parseMoneyCents(cell(row, "amount"));
    if (amountCents === null) {
      skipped.push({ row: i + 1, reason: "No amount on this row." });
      continue;
    }

    const name = text(cell(row, "name"));
    const email = text(cell(row, "email"));
    const phone = text(cell(row, "phone"));
    if (!name && !email && !phone) {
      // Nothing to match a client on. Worth saying rather than importing an
      // orphan payment nobody can attribute.
      skipped.push({ row: i + 1, reason: "No name, email or phone to match a client on." });
      continue;
    }

    drafts.push({
      externalId: text(cell(row, "externalId")),
      name,
      email,
      phone,
      amountCents,
      paidOn: parseDate(cell(row, "date")),
      status: normaliseStatus(cell(row, "status")),
      description: text(cell(row, "description")),
      method: text(cell(row, "method")),
    });
  }

  return { drafts, skipped, unmatchedHeaders };
}

/** What the preview says before anybody presses import. */
export interface TransactionPreview {
  total: number;
  settled: number;
  settledCents: number;
  refunded: number;
  failed: number;
  undated: number;
}

export function previewTransactions(drafts: TransactionDraft[]): TransactionPreview {
  let settled = 0;
  let settledCents = 0;
  let refunded = 0;
  let failed = 0;
  let undated = 0;

  for (const draft of drafts) {
    if (isSettled(draft)) {
      settled += 1;
      settledCents += draft.amountCents;
    }
    if (draft.status === "refunded") refunded += 1;
    if (draft.status === "failed") failed += 1;
    if (!draft.paidOn) undated += 1;
  }

  return { total: drafts.length, settled, settledCents, refunded, failed, undated };
}

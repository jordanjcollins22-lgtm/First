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
  /** The exporting CRM's own contact id, where the file carries one. The
   * strongest way to find the client: the contact import stored exactly this
   * against every one of them, so it beats matching on a name. */
  customerExternalId: string | null;
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
  /**
   * A test charge rather than a real one.
   *
   * Kept and flagged rather than dropped in the parser, so the preview can
   * say how many there were and what they came to. Silently vanishing rows
   * is how somebody spends an evening looking for three hundred pounds.
   */
  testMode: boolean;
  /** The processor's own id, for reconciling against the processor. */
  chargeId: string | null;
  /** Anything not in dollars, which this cannot convert and must not assume. */
  currency: string | null;
  /** Money given back on an otherwise successful charge. */
  refundedCents: number;
  /** What the processor took. Goes to the ledger as an expense rather than
   * being netted off the payment: what the client paid is what they paid. */
  feeCents: number;
  /** What was taken off the invoice before they paid. Reported, not recorded
   * as money, since it never moved. */
  discountCents: number;
}

export type TransactionStatus = "succeeded" | "refunded" | "failed" | "pending" | "unknown";

export interface TransactionReport {
  drafts: TransactionDraft[];
  skipped: { row: number; reason: string }[];
  /** Columns nothing claimed, so a file carrying something this does not read
   * says so instead of losing it. */
  unmatchedHeaders: string[];
}

/**
 * The names an export gives each thing, best first.
 *
 * Order is the whole design here. A real export carries "Total amount due"
 * and "Total amount paid" side by side, and they are not the same number: a
 * client invoiced eight thousand who paid a five hundred deposit has both on
 * one row. Reading the wrong one records money that never arrived, so the
 * aliases are searched in preference order and the first one present wins,
 * rather than taking whichever column happens to appear first in the file.
 */
const COLUMN_ALIASES = {
  externalId: [
    "internal transaction id",
    "transaction id",
    "payment id",
    "charge id",
    "internal order id",
    "receipt number",
    "reference number",
    "reference",
    "id",
  ],
  /** The exporting CRM's own contact id. The strongest match there is, since
   * the contact import stored exactly this against every client. */
  customerExternalId: ["customer id", "contact id", "customer external id"],
  name: ["customer name", "name", "contact name", "billing name", "payer", "customer", "contact"],
  email: ["customer email", "email", "billing email", "contact email", "email address"],
  phone: ["customer phone", "phone", "billing phone", "contact phone", "phone number"],
  /** What actually arrived, never what was billed. */
  amount: [
    "total amount paid",
    "amount paid",
    "amount received",
    "amount",
    "gross amount",
    "gross",
    "paid",
    "total",
    "price",
    "value",
  ],
  date: [
    "transaction date",
    "payment date",
    "date paid",
    "paid at",
    "completed at",
    "created at",
    "created date",
    "created",
    "date",
  ],
  status: ["status", "payment status", "state", "result"],
  /** Whether this was a real charge or a test one. */
  liveMode: ["live mode", "livemode", "is live", "mode"],
  /** The processor's own id, so a payment here can be reconciled against
   * what the processor says. */
  chargeId: ["charge id", "payment intent id", "stripe charge id", "processor id"],
  /** What the payment came through: an invoice, a booking form, a calendar.
   * Often a better description of the work than the line item. */
  sourceName: ["source name", "source", "invoice name", "form name"],
  currency: ["currency", "currency code"],
  /** Money given back on a transaction that otherwise succeeded. */
  refundedAmount: ["amount refunded", "refunded amount", "refund amount"],
  /** What the processor took to handle the payment. Not a reduction in what
   * the client paid: an expense the business incurred to take it. */
  fee: ["processing charge amount", "processing fee", "fee", "fees", "stripe fee"],
  /** What was knocked off the invoice. Not money, but worth knowing. */
  discount: ["discount", "discount amount", "total discount"],
  /** A separate yes/no column some exports carry alongside the status. */
  refundedFlag: ["is refunded", "refunded"],
  description: [
    "line item name",
    "description",
    "product name",
    "product",
    "item",
    "line item",
    "memo",
    "notes",
  ],
  method: ["payment method", "method", "payment type", "card brand", "type"],
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

/**
 * Money we actually have, and which may move a job forward.
 *
 * A test charge is not money. Three of them in a real export came to three
 * hundred and seventy dollars, which is small enough to be invisible on a
 * dashboard and exactly the kind of thing that makes a total impossible to
 * reconcile against a bank statement.
 *
 * A currency this cannot convert is refused for the same reason: recording
 * two thousand euros as two thousand dollars is a number that will never be
 * questioned because it looks perfectly ordinary.
 */
export function isSettled(draft: TransactionDraft): boolean {
  if (draft.testMode) return false;
  if (draft.currency && draft.currency.toUpperCase() !== "USD") return false;
  return draft.status === "succeeded" && netCents(draft) > 0;
}

/** What was actually kept: the payment less anything given back on it. */
export function netCents(draft: TransactionDraft): number {
  return draft.amountCents - draft.refundedCents;
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
    // Walk the aliases rather than the headers, so preference decides which
    // column is taken when a file carries several that could fit.
    for (const alias of aliases) {
      const found = headers.indexOf(alias);
      if (found >= 0) {
        index[field] = found;
        claimed.add(found);
        break;
      }
    }
  }

  const unmatchedHeaders = rows[0]
    .filter((_, i) => !claimed.has(i))
    .filter((h) => h.trim().length > 0);

  const drafts: TransactionDraft[] = [];
  const skipped: { row: number; reason: string }[] = [];
  /** Where each transaction id landed in drafts, so its extra line-item rows
   * can be folded into the one payment rather than counted again. */
  const seen = new Map<string, number>();

  const cell = (row: string[], field: keyof typeof COLUMN_ALIASES) => {
    const at = index[field];
    return at === undefined ? undefined : row[at];
  };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every((c) => !c.trim())) continue;

    const externalId = text(cell(row, "externalId"));
    const lineItem = text(cell(row, "description"));

    // One transaction with three things on it comes back as three rows, and
    // only the first carries the money — the rest are its line items with an
    // empty amount. Counting those as payments would treble the row count and
    // skipping them would lose what the job was for, so they are folded into
    // the payment they belong to.
    const already = externalId ? seen.get(externalId) : undefined;
    if (already !== undefined) {
      const existing = drafts[already];
      if (lineItem && !existing.description?.includes(lineItem)) {
        existing.description = existing.description ? `${existing.description}, ${lineItem}` : lineItem;
      }
      // A later row of the same transaction can be the one carrying the money.
      if (existing.amountCents === 0) {
        const late = parseMoneyCents(cell(row, "amount"));
        if (late !== null) existing.amountCents = late;
      }
      continue;
    }

    const amountCents = parseMoneyCents(cell(row, "amount"));
    if (amountCents === null) {
      skipped.push({ row: i + 1, reason: "No amount on this row." });
      continue;
    }

    const name = text(cell(row, "name"));
    const email = text(cell(row, "email"));
    const phone = text(cell(row, "phone"));
    const customerExternalId = text(cell(row, "customerExternalId"));
    if (!name && !email && !phone && !customerExternalId) {
      // Nothing to match a client on. Worth saying rather than importing an
      // orphan payment nobody can attribute.
      skipped.push({ row: i + 1, reason: "Nothing on this row to match a client on." });
      continue;
    }

    // Some exports carry the refund as its own column rather than in the
    // status, and a row saying "Full" against a status of "succeeded" is a
    // refund whatever the status says.
    const refundFlag = (text(cell(row, "refundedFlag")) ?? "").toLowerCase();
    const refunded = refundFlag === "full" || refundFlag === "partial" || refundFlag === "yes";

    const live = (text(cell(row, "liveMode")) ?? "").toLowerCase();
    const refundedCents = parseMoneyCents(cell(row, "refundedAmount")) ?? 0;

    if (externalId) seen.set(externalId, drafts.length);
    drafts.push({
      externalId,
      customerExternalId,
      name,
      email,
      phone,
      amountCents,
      paidOn: parseDate(cell(row, "date")),
      status: refunded ? "refunded" : normaliseStatus(cell(row, "status")),
      // What it came through is usually a better description of the work than
      // the line item: "Snow Removal Booking Form" says more than "Scope".
      description: text(cell(row, "sourceName")) ?? lineItem,
      method: text(cell(row, "method")),
      testMode: live === "no" || live === "false" || live === "test",
      chargeId: text(cell(row, "chargeId")),
      currency: text(cell(row, "currency")),
      refundedCents: Math.abs(refundedCents),
      feeCents: Math.abs(parseMoneyCents(cell(row, "fee")) ?? 0),
      discountCents: Math.abs(parseMoneyCents(cell(row, "discount")) ?? 0),
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
  /** Test charges. Counted and named rather than dropped in silence. */
  testMode: number;
  testModeCents: number;
  /** Rows in a currency this cannot convert. */
  otherCurrency: number;
  /** What the processor took across the file. An expense, not a deduction. */
  feesCents: number;
  /** What was knocked off invoices. Never money, but worth seeing. */
  discountsCents: number;
}

export function previewTransactions(drafts: TransactionDraft[]): TransactionPreview {
  let settled = 0;
  let settledCents = 0;
  let refunded = 0;
  let failed = 0;
  let undated = 0;
  let testMode = 0;
  let testModeCents = 0;
  let otherCurrency = 0;
  let feesCents = 0;
  let discountsCents = 0;

  for (const draft of drafts) {
    if (isSettled(draft)) {
      settled += 1;
      settledCents += netCents(draft);
      // Only on money that actually arrived. A fee on a failed charge is not
      // a fee anybody paid.
      feesCents += draft.feeCents;
      discountsCents += draft.discountCents;
    }
    if (draft.testMode) {
      testMode += 1;
      testModeCents += draft.amountCents;
    }
    if (draft.currency && draft.currency.toUpperCase() !== "USD") otherCurrency += 1;
    if (draft.status === "refunded") refunded += 1;
    if (draft.status === "failed") failed += 1;
    if (!draft.paidOn) undated += 1;
  }

  return {
    total: drafts.length,
    settled,
    settledCents,
    refunded,
    failed,
    undated,
    testMode,
    testModeCents,
    otherCurrency,
    feesCents,
    discountsCents,
  };
}

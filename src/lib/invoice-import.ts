/**
 * Invoices brought in from wherever they were raised.
 *
 * The table was built for a file somebody uploads — a PDF with the numbers
 * typed in beside it. An export has the opposite shape: every number and no
 * file at all. Both are real invoices, and this reads the second kind.
 *
 * Two things about the real export shape decide most of what is here. A
 * multi-line invoice is several rows and only the first carries the invoice
 * total, so the rest must be folded in rather than counted as separate bills.
 * And the total is not the sum of the line items: there is a discount between
 * them, and adding the lines up would bill several clients ten per cent more
 * than they were actually charged.
 */

import { parseCsv } from "@/lib/prospect-import";
import { parseDate, parseMoneyCents } from "@/lib/transaction-import";

export interface InvoiceDraft {
  /** The exporting system's own invoice number, e.g. INV-000066. The key a
   * re-import updates on. */
  externalId: string | null;
  /** What the invoice was called, e.g. "Willoughby Proposal". */
  title: string | null;
  /** What is actually owed: after the discount, not the sum of the lines. */
  totalCents: number | null;
  subtotalCents: number | null;
  discountCents: number | null;
  issuedOn: string | null;
  dueOn: string | null;
  /** The exporting system's own word for where it stands. */
  status: InvoiceSourceStatus;
  /** The contact, as the export identified them. */
  customerExternalId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  /** The written scope, as the source stored it. HTML from a rich text
   * editor, kept as it came. */
  scopeHtml: string | null;
  /** A real invoice rather than a test one. */
  testMode: boolean;
}

export type InvoiceSourceStatus = "paid" | "partial" | "overdue" | "open" | "void" | "unknown";

export interface InvoiceReport {
  drafts: InvoiceDraft[];
  skipped: { row: number; reason: string }[];
  unmatchedHeaders: string[];
}

const COLUMN_ALIASES = {
  number: ["invoice number", "invoice no", "invoice id", "number"],
  name: ["invoice name", "name", "title"],
  // Preference order matters: the real file carries both a subtotal and a
  // total, and the total is the one that is owed.
  total: ["invoice total", "total", "amount due", "grand total", "amount"],
  subtotal: ["invoice sub total", "invoice subtotal", "sub total", "subtotal"],
  discount: ["invoice discount amount", "discount amount", "discount"],
  issuedOn: ["issue date", "issued on", "invoice date", "created date", "created"],
  dueOn: ["due date", "due on", "due"],
  status: ["status", "invoice status", "state"],
  liveMode: ["live mode", "livemode", "is live", "mode"],
  customerExternalId: ["customer id", "contact id", "client id"],
  customerName: ["customer name", "contact name", "client name", "name of customer"],
  customerEmail: ["customer email", "contact email", "client email", "email"],
  customerPhone: ["customer phone no", "customer phone", "contact phone", "phone"],
  scope: ["line item description", "description", "scope", "line item name"],
} as const;

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[_\-.]/g, " ").replace(/\s+/g, " ").trim();
}

function text(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * What the file's status word means.
 *
 * The not-money answers are checked first and the paid test uses a word
 * boundary, because "unpaid" contains "paid" and reading it as settled is how
 * an unpaid bill stops being chased. "Partially paid" is checked before
 * "paid" for the same reason in reverse: some money arrived, which is not the
 * same as the bill being closed.
 */
export function normaliseInvoiceStatus(value: string | undefined): InvoiceSourceStatus {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return "unknown";

  if (/void|cancel|deleted|written off/.test(raw)) return "void";
  if (/partial/.test(raw)) return "partial";
  if (/overdue|past due|late/.test(raw)) return "overdue";
  if (/unpaid|outstanding|awaiting|pending|\bopen\b|\bsent\b|\bdraft\b/.test(raw)) return "open";
  if (/\bpaid\b|settled|complete/.test(raw)) return "paid";
  return "unknown";
}

/** A test invoice is not a bill anybody owes. Blank counts as live: an export
 * without the column is a live one, and treating every row as a test would
 * import nothing at all. */
function isLive(value: string | undefined): boolean {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return true;
  return !/^(no|false|0|test)$/.test(raw);
}

/**
 * The scope of several line items, joined.
 *
 * Each row of a multi-line invoice describes one part of the job, and the
 * whole scope is all of them. Joined rather than replaced, because keeping
 * only the first would quietly drop two thirds of what was sold.
 */
function joinScope(existing: string | null, addition: string | null): string | null {
  if (!addition) return existing;
  if (!existing) return addition;
  if (existing.includes(addition)) return existing;
  return `${existing}\n${addition}`;
}

export function parseInvoiceCsv(csvText: string): InvoiceReport {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    return {
      drafts: [],
      skipped: [{ row: 0, reason: "That file has no rows in it." }],
      unmatchedHeaders: [],
    };
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

  const drafts: InvoiceDraft[] = [];
  const skipped: { row: number; reason: string }[] = [];
  /** Where each invoice number landed, so the extra line-item rows fold into
   * the one bill rather than becoming bills of their own. */
  const seen = new Map<string, number>();

  const cell = (row: string[], field: keyof typeof COLUMN_ALIASES) => {
    const at = index[field];
    return at === undefined ? undefined : row[at];
  };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every((value) => !value.trim())) continue;

    const number = text(cell(row, "number"));
    const scope = text(cell(row, "scope"));

    // A continuation row: same invoice, another line item. Only its scope is
    // new -- the totals sat on the first row.
    if (number && seen.has(number)) {
      const at = seen.get(number)!;
      drafts[at].scopeHtml = joinScope(drafts[at].scopeHtml, scope);
      continue;
    }

    const totalCents = parseMoneyCents(cell(row, "total"));
    if (totalCents == null) {
      skipped.push({
        row: i + 1,
        reason: number
          ? `${number} has no total on it.`
          : "No invoice number and no total, so there is nothing to file.",
      });
      continue;
    }

    const draft: InvoiceDraft = {
      externalId: number,
      title: text(cell(row, "name")),
      totalCents,
      subtotalCents: parseMoneyCents(cell(row, "subtotal")),
      discountCents: parseMoneyCents(cell(row, "discount")),
      issuedOn: parseDate(cell(row, "issuedOn")),
      dueOn: parseDate(cell(row, "dueOn")),
      status: normaliseInvoiceStatus(cell(row, "status")),
      customerExternalId: text(cell(row, "customerExternalId")),
      customerName: text(cell(row, "customerName")),
      customerEmail: text(cell(row, "customerEmail")),
      customerPhone: text(cell(row, "customerPhone")),
      scopeHtml: scope,
      testMode: !isLive(cell(row, "liveMode")),
    };

    if (number) seen.set(number, drafts.length);
    drafts.push(draft);
  }

  return { drafts, skipped, unmatchedHeaders };
}

export interface InvoicePreview {
  /** Real invoices, test rows excluded. */
  count: number;
  totalCents: number;
  paid: number;
  outstanding: number;
  /** Rows the export marked as a test. Never imported, always reported. */
  testRows: number;
  /** Invoices carrying no contact detail at all, which cannot be filed
   * against anybody. */
  noContact: number;
  withScope: number;
}

/** Money the business has asked for. A void invoice is not owed and not
 * billed; it is a bill that was withdrawn. */
export function isBillable(draft: InvoiceDraft): boolean {
  return !draft.testMode && draft.status !== "void";
}

export function previewInvoices(drafts: InvoiceDraft[]): InvoicePreview {
  const preview: InvoicePreview = {
    count: 0,
    totalCents: 0,
    paid: 0,
    outstanding: 0,
    testRows: 0,
    noContact: 0,
    withScope: 0,
  };

  for (const draft of drafts) {
    if (draft.testMode) {
      preview.testRows += 1;
      continue;
    }
    if (!isBillable(draft)) continue;

    preview.count += 1;
    preview.totalCents += draft.totalCents ?? 0;
    if (draft.status === "paid") preview.paid += 1;
    else preview.outstanding += 1;

    if (!draft.customerExternalId && !draft.customerEmail && !draft.customerName) {
      preview.noContact += 1;
    }
    if (draft.scopeHtml) preview.withScope += 1;
  }

  return preview;
}

/** The sentence under the file picker, before anything is written. */
export function previewLine(preview: InvoicePreview): string {
  if (preview.count === 0) return "Nothing in that file to bring in.";

  const money = (cents: number) =>
    (cents / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });

  const parts = [`${preview.count} invoices, ${money(preview.totalCents)} billed`];
  if (preview.paid > 0) parts.push(`${preview.paid} already paid`);
  if (preview.outstanding > 0) parts.push(`${preview.outstanding} still owed`);
  if (preview.withScope > 0) parts.push(`${preview.withScope} carrying their scope of work`);
  // Said every time, so the number on screen reconciles against the file
  // rather than leaving somebody to wonder where the rest went.
  if (preview.testRows > 0) parts.push(`${preview.testRows} test rows, not counted`);
  if (preview.noContact > 0) parts.push(`${preview.noContact} with nobody named on them`);

  return `${parts.join(". ")}.`;
}

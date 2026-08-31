/**
 * Invoices as files, against the person they were sent to.
 *
 * What the office needs from a bill is three things: what we charged, when it
 * was due, and whether it came in. A folder of PDFs answers none of them, so
 * each file carries those alongside it.
 *
 * Status is worked out here rather than stored. An invoice is not 'overdue'
 * the day somebody types it in; it becomes overdue the morning after its due
 * date, whether or not anybody was looking. A stored status is a second thing
 * to keep in step, and this is one that would start lying overnight.
 */

import { planProgress, type PlanLike } from "@/lib/plan-progress";

/** The plan paying an invoice off, as this module needs to see it. */
export interface InvoicePlan extends PlanLike {
  kind: string;
}

export interface ClientInvoice {
  id: string;
  customerId: string;
  customerName: string | null;
  /** Null for one that came from an export rather than an upload. */
  filePath: string | null;
  fileName: string | null;
  title: string | null;
  /** The written scope, as the source system stored it. */
  scopeHtml: string | null;
  /** What the system it came from said. An external claim, not something
   * worked out here. */
  sourceStatus: string | null;
  invoiceNumber: string | null;
  amount: number | null;
  issuedOn: string | null;
  dueOn: string | null;
  paidOn: string | null;
  notes: string | null;
  /** The schedule settling this bill, when one was agreed. */
  plan?: InvoicePlan | null;
}

export type InvoiceStatus =
  | "partly-paid"
  | "paid"
  | "overdue"
  | "due-soon"
  | "outstanding"
  | "undated"
  | "on-plan";

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  paid: "Paid",
  overdue: "Overdue",
  "due-soon": "Due soon",
  outstanding: "Outstanding",
  undated: "No due date",
  "on-plan": "On a payment plan",
  "partly-paid": "Part paid",
};

/** Inside this many days of the due date, it is worth chasing. */
const SOON_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A date-only string as a day number, so nothing here depends on the clock's
 * time of day or on which side of midnight a timezone puts it. */
function dayNumber(iso: string): number | null {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / DAY_MS);
}

/**
 * Where an invoice stands, today.
 *
 * Paid wins over everything: an invoice settled late is paid, not overdue,
 * and a list that keeps shouting about money already in the bank is a list
 * people stop reading.
 *
 * A payment plan comes next, and it supersedes the invoice's own due date.
 * That date was the terms before anybody renegotiated; once a client has
 * agreed to pay over three months, calling the bill overdue in month one is
 * telling the office to chase somebody who is doing exactly what was agreed.
 * Behind on the plan is a different matter, and still overdue.
 */
export function invoiceStatus(invoice: ClientInvoice, today = new Date()): InvoiceStatus {
  if (invoice.paidOn) return "paid";

  if (invoice.plan && invoice.plan.status !== "cancelled") {
    const progress = planProgress(invoice.plan, today);
    if (progress.settled) return "paid";
    return progress.overdue.length > 0 ? "overdue" : "on-plan";
  }

  // What the source system said, where there is nothing better. Ordinarily
  // paid-ness is derived from money received, but the payments export and the
  // invoice export share no key, so nothing here can join a bill to the
  // payment that settled it. The file's own word is the best evidence there
  // is; it is used only after a real payment date and a real plan, both of
  // which are this app's own facts and outrank it.
  const claimed = (invoice.sourceStatus ?? "").toLowerCase();
  if (claimed === "paid") return "paid";
  if (claimed === "partial") return "partly-paid";
  if (claimed === "void") return "paid";

  if (!invoice.dueOn) return "undated";

  const due = dayNumber(invoice.dueOn);
  const now = dayNumber(today.toISOString().slice(0, 10));
  if (due == null || now == null) return "undated";

  if (due < now) return "overdue";
  if (due - now <= SOON_DAYS) return "due-soon";
  return "outstanding";
}

/**
 * How many days late, for an invoice that is late. Zero otherwise.
 *
 * Measured from the plan's oldest missed payment when there is a plan, since
 * that is the date that was actually missed. Counting from the original due
 * date would report a bill as months late when the schedule that replaced it
 * was missed last week.
 */
export function daysOverdue(invoice: ClientInvoice, today = new Date()): number {
  if (invoiceStatus(invoice, today) !== "overdue") return 0;

  const now = dayNumber(today.toISOString().slice(0, 10));
  if (now == null) return 0;

  const from = invoice.plan
    ? planProgress(invoice.plan, today).overdue[0]?.dueOn
    : invoice.dueOn;
  if (!from) return 0;

  const due = dayNumber(from);
  return due == null ? 0 : now - due;
}

/**
 * What is still owed on an invoice, in cents.
 *
 * A plan knows what has actually been paid against it; an invoice on its own
 * only knows whether somebody ticked it off. Where there is a plan, its
 * arithmetic wins -- otherwise a bill half paid down reads as owed in full.
 */
export function owedCents(invoice: ClientInvoice, today = new Date()): number {
  if (invoiceStatus(invoice, today) === "paid") return 0;
  if (invoice.plan) return planProgress(invoice.plan, today).outstandingCents;
  return cents(invoice.amount);
}

export interface InvoiceSummary {
  total: number;
  paid: number;
  outstanding: number;
  overdue: number;
  /** Outstanding, but being paid down to an agreed schedule and up to date
   * on it. Not something to chase. */
  onPlan: number;
  /** In cents, so nothing here does arithmetic on floats. */
  billedCents: number;
  paidCents: number;
  owedCents: number;
}

const cents = (amount: number | null): number => (amount == null ? 0 : Math.round(amount * 100));

export function summariseInvoices(rows: ClientInvoice[], today = new Date()): InvoiceSummary {
  const summary: InvoiceSummary = {
    total: rows.length,
    paid: 0,
    outstanding: 0,
    overdue: 0,
    onPlan: 0,
    billedCents: 0,
    paidCents: 0,
    owedCents: 0,
  };

  for (const row of rows) {
    const status = invoiceStatus(row, today);
    const value = cents(row.amount);
    summary.billedCents += value;

    if (status === "paid") {
      summary.paid += 1;
      summary.paidCents += value;
      continue;
    }

    summary.outstanding += 1;
    // What is left after anything already paid down a plan, rather than the
    // face value of the bill.
    const left = owedCents(row, today);
    summary.owedCents += left;
    summary.paidCents += value - left;
    if (status === "overdue") summary.overdue += 1;
    if (status === "on-plan") summary.onPlan += 1;
  }

  return summary;
}

/**
 * The line above the list.
 *
 * Leads with what is owed, because that is the number somebody opened this to
 * find. An amount is only claimed when there is one to claim: invoices with no
 * amount typed in are counted but never quietly treated as zero.
 */
export function invoiceLine(summary: InvoiceSummary): string {
  if (summary.total === 0) return "No invoices on file yet.";

  const money = (c: number) =>
    (c / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });

  const parts: string[] = [];
  if (summary.outstanding > 0) {
    parts.push(
      summary.owedCents > 0
        ? `${money(summary.owedCents)} outstanding across ${summary.outstanding}`
        : `${summary.outstanding} outstanding`
    );
  }
  if (summary.overdue > 0) parts.push(`${summary.overdue} overdue`);
  if (summary.onPlan > 0) parts.push(`${summary.onPlan} on a payment plan`);
  if (summary.paid > 0) parts.push(`${summary.paid} paid`);

  const invoices = summary.total === 1 ? "1 invoice" : `${summary.total} invoices`;
  return parts.length > 0 ? `${invoices} — ${parts.join(", ")}.` : `${invoices}.`;
}

/**
 * Overdue first and oldest of those first, then everything else by date.
 *
 * The order is the point: this list is worked from the top, and the money
 * that has been owed longest is the money most worth a phone call. Paid
 * invoices sink, since nothing needs doing about them.
 */
export function byUrgency(rows: ClientInvoice[], today = new Date()): ClientInvoice[] {
  const rank: Record<InvoiceStatus, number> = {
    overdue: 0,
    "due-soon": 1,
    outstanding: 2,
    // Being paid to an agreed schedule and up to date on it. Below the ones
    // that need a phone call, above the ones that need nothing.
    "on-plan": 3,
    // Some money is in and the rest is not chased on a date anybody has.
    "partly-paid": 4,
    undated: 5,
    paid: 6,
  };

  return [...rows].sort((a, b) => {
    const byRank = rank[invoiceStatus(a, today)] - rank[invoiceStatus(b, today)];
    if (byRank !== 0) return byRank;

    // Within a band, the oldest due date first — that is the one that has
    // been waiting longest. Anything undated goes last in its own band.
    const aKey = a.dueOn ?? a.issuedOn;
    const bKey = b.dueOn ?? b.issuedOn;
    if (!aKey && !bKey) return 0;
    if (!aKey) return 1;
    if (!bKey) return -1;
    return aKey.localeCompare(bKey);
  });
}

/** Twenty-five megabytes, matching the proposal archive: a scanned invoice is
 * the big one, and a ceiling somebody hits while filing a year of them is a
 * ceiling that stops the filing. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg"];

export interface FileCheck {
  ok: boolean;
  /** Everything wrong with it at once. Somebody picking files off a phone
   * should not fix them one round trip at a time. */
  message: string | null;
}

export function checkInvoiceFile(file: { type: string; size: number }): FileCheck {
  const faults: string[] = [];
  if (!ACCEPTED_TYPES.includes(file.type)) faults.push("It needs to be a PDF, a PNG or a JPG.");
  if (file.size > MAX_FILE_BYTES) {
    faults.push(
      `It is ${(file.size / 1024 / 1024).toFixed(1)}MB, and the limit is ${MAX_FILE_BYTES / 1024 / 1024}MB.`
    );
  }
  if (file.size === 0) faults.push("That file is empty.");
  return { ok: faults.length === 0, message: faults.length > 0 ? faults.join(" ") : null };
}

export function extensionFor(type: string): string {
  if (type === "application/pdf") return "pdf";
  if (type === "image/png") return "png";
  return "jpg";
}

/**
 * An invoice number read off the file name, when there is one to read.
 *
 * Saves typing the thing that is nearly always in the name already. Only a
 * clear number is offered: guessing wrong and pre-filling the field is worse
 * than leaving it empty, because a wrong value that looks filled in gets
 * saved.
 */
export function numberFromFileName(fileName: string): string | null {
  const stem = fileName.replace(/\.[a-z0-9]+$/i, "");
  // The letter prefix is optional and may be hyphenated off the digits, so
  // "Invoice #A-155" keeps its A and "INV-2291" does not gain one.
  const match = stem.match(/inv(?:oice)?[ _-]*#?\s*((?:[a-z]+-)?\d[a-z0-9-]*)/i);
  if (match?.[1]) return match[1].toUpperCase();

  // A file named nothing but a number is that number.
  const bare = stem.match(/^#?\s*(\d{3,})$/);
  return bare?.[1] ?? null;
}

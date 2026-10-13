/**
 * Invoice reminders: when an open invoice is due, which nudges it gets, what
 * they say, and when it stops being a reminder and becomes a collections job
 * for a person.
 *
 * The rule (reminder_rules, kind invoice_reminder) holds the timing and the
 * channels, counted from the due date: -72 hours is the pre-due nudge, 0 the
 * due date, then 7 and 21 days late. The client-reminders run gathers the
 * invoices and sends; this file is the arithmetic and the words. Pure.
 */

import type { Channel } from "@/lib/client-consent";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Payment terms on every invoice the app raises. invoicing.ts creates them in
 * Stripe with days_until_due: 30, and the invoices table does not keep
 * Stripe's due date, so it is worked out from when it was sent.
 */
export const INVOICE_TERMS_DAYS = 30;

/** The new default timing: 3 days before, on the day, 7 and 21 days late. */
export const INVOICE_OFFSETS_HOURS = [-72, 0, 168, 504];

export interface InvoiceFacts {
  id: string;
  status: string;
  amount: number;
  sentAt: string | null;
  createdAt: string;
  paidAt: string | null;
  hostedInvoiceUrl: string | null;
  /** The client said they'll pay cash or check; somebody is collecting it. */
  payBy: string | null;
}

/** The moment the invoice falls due: the morning of the 30th day after it went. */
export function invoiceDueAt(invoice: Pick<InvoiceFacts, "sentAt" | "createdAt">): Date {
  const from = new Date(invoice.sentAt ?? invoice.createdAt);
  return new Date(from.getTime() + INVOICE_TERMS_DAYS * DAY);
}

/**
 * Whether there is nothing left to remind anybody about. Paid, voided or
 * written off is done; so is an invoice with no amount on it.
 */
export function invoiceSettled(invoice: Pick<InvoiceFacts, "status" | "paidAt" | "amount">): boolean {
  if (invoice.paidAt) return true;
  if (!(Number(invoice.amount) > 0)) return true;
  return invoice.status !== "open";
}

/**
 * Whether the client gets nudges at all. An invoice somebody is collecting in
 * cash or by check is a visit, not a text: reminding them to "pay online" is
 * wrong and slightly rude. It still reaches collections if it is never paid.
 */
export function invoiceTakesReminders(invoice: Pick<InvoiceFacts, "payBy">): boolean {
  return !invoice.payBy;
}

/**
 * Whether the invoice has run past the last reminder and needs a person.
 * True from `afterDays` past due until it is paid or voided.
 */
export function needsCollections(invoice: InvoiceFacts, now: Date, afterDays: number): boolean {
  if (invoiceSettled(invoice)) return false;
  return now.getTime() >= invoiceDueAt(invoice).getTime() + afterDays * DAY;
}

export function collectionsKey(invoiceId: string): string {
  return `collections:${invoiceId}`;
}

const money = (n: number) =>
  `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })}`;

const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";

/**
 * The words for one nudge, which change with where it falls: a friendly
 * heads-up before, a plain "due today", then two firmer notes. Every one
 * carries the pay link, because a reminder you cannot act on is a nag.
 */
export function invoiceReminderMessage(input: {
  offsetHours: number;
  channel: Channel;
  businessName: string;
  clientName: string | null;
  amount: number;
  dueAt: Date;
  timeZone: string;
  payLink: string | null;
  includeOptOut?: boolean;
  unsubscribeUrl?: string | null;
  howToReply?: string;
}): { subject: string; body: string } {
  const hi = firstName(input.clientName) ? `Hi ${firstName(input.clientName)}, ` : "";
  const amount = money(input.amount);
  const dueDay = new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone, weekday: "long", month: "long", day: "numeric" }).format(input.dueAt);
  const daysLate = Math.round(input.offsetHours / 24);

  let subject: string;
  let line: string;
  if (input.offsetHours < 0) {
    subject = `Your invoice for ${amount} is due ${dueDay}`;
    line = `${hi}a heads-up that your invoice for ${amount} is due ${dueDay}.`;
  } else if (input.offsetHours === 0) {
    subject = `Your invoice for ${amount} is due today`;
    line = `${hi}your invoice for ${amount} is due today.`;
  } else if (input.offsetHours < 21 * 24) {
    subject = `Your invoice for ${amount} is ${daysLate} days past due`;
    line = `${hi}your invoice for ${amount} was due ${dueDay} and is still open.`;
  } else {
    subject = `Second notice: ${amount} still open`;
    line = `${hi}your invoice for ${amount} is now ${daysLate} days past due. If something about the work is holding it up, reply and tell us so we can put it right.`;
  }
  const pay = input.payLink ? `You can pay here: ${input.payLink}` : "Reply and we will send you a link to pay.";
  const paid = "If you have already paid, thank you, and please ignore this.";

  if (input.channel === "sms") {
    const text = `${input.businessName}: ${line} ${pay}`;
    return { subject: "", body: input.includeOptOut ? `${text} Reply STOP to stop.` : text };
  }
  const foot = [input.howToReply, input.businessName, input.unsubscribeUrl ? `Not want these reminders? ${input.unsubscribeUrl}` : null].filter(
    (part): part is string => Boolean(part)
  );
  return { subject, body: [line, pay, paid, ...foot].join("\n\n") };
}

/**
 * Who counts as a client.
 *
 * A client is somebody we have done business with: they have paid us, or we
 * have billed them. Everyone else is a lead, however warm, however many
 * quotes they have had, however long they have been on the books.
 *
 * The invoice half matters because the money and the bill do not always
 * arrive together. Payments imported from the card processor and invoices
 * imported from the old CRM share no key, so twenty people here were billed
 * for work with no payment this app can join to the bill — and a person we
 * sent a bill to is not a lead, whatever the payments table can prove. An
 * unpaid invoice makes somebody a client too: they agreed to the work, and
 * being owed money is a relationship, not a prospect.
 *
 * None of this is a labelling preference. A book where a thousand people are
 * called clients is a book where the word carries no information, and every
 * count built on it — how many clients, what a client is worth, how many came
 * from flyers — is measuring something else. This book says 1,746 of 1,758
 * are clients, which is what an import wrote rather than what is true.
 *
 * So it is derived rather than typed on a form. Nobody has to remember to
 * change it, it cannot be wrong, and the first bill or the first payment
 * turns somebody into a client everywhere at once.
 *
 * The other kinds are untouched. A supplier is a supplier because of what
 * they do with us, not because of which direction money went, and a business
 * on the flyer list has paid us and is still not a landscaping client.
 */

import type { ContactType } from "@/lib/contact-types";

/** The kinds where paying us decides what somebody is. Everything else is a
 * standing relationship that money does not define. */
const DECIDED_BY_MONEY = new Set<string>(["client", "lead", "other", ""]);

export interface ContactMoney {
  /** What this contact has actually paid, in cents. Settled money only. */
  paidCents: number;
  /** How many invoices we have raised against them. Optional, because plenty
   * of callers ask this question before invoices are in the picture, and a
   * missing count means "none known" rather than "none". */
  invoiceCount?: number;
  /** What the office typed on their record, where they typed anything. */
  contactType: string | null;
}

/** Paid us anything at all. */
export function hasPaid(money: ContactMoney): boolean {
  return money.paidCents > 0;
}

/** Been sent a bill. Paid or not — a bill is business either way. */
export function hasBeenBilled(money: ContactMoney): boolean {
  return (money.invoiceCount ?? 0) > 0;
}

/** Done business with us, by either measure. */
export function isClient(money: ContactMoney): boolean {
  return hasPaid(money) || hasBeenBilled(money);
}

/**
 * What this contact actually is, given the money.
 *
 * A supplier who has paid us for something is still a supplier. A person on
 * the book who has paid is a client, and one who has not is a lead, whatever
 * an old import happened to write on the row.
 */
export function effectiveType(money: ContactMoney): ContactType | string {
  const stated = money.contactType ?? "";
  if (!DECIDED_BY_MONEY.has(stated)) return stated;
  return isClient(money) ? "client" : "lead";
}

/** True where the stored type says client and the money does not agree. Worth
 * knowing on a screen that is about to be used to decide who to ring. */
export function miscalledClient(money: ContactMoney): boolean {
  return money.contactType === "client" && !isClient(money);
}

export interface BookSummary {
  clients: number;
  leads: number;
  /** Rows the book calls clients that have neither paid nor been billed. */
  miscalled: number;
  /** Clients we have billed but have no payment recorded against. Not an
   * error — the payments and the invoices came from different systems and
   * cannot be joined — but it is money to chase or a receipt to find. */
  billedUnpaid: number;
}

export function summariseBook(contacts: ContactMoney[]): BookSummary {
  let clients = 0;
  let leads = 0;
  let miscalled = 0;
  let billedUnpaid = 0;

  for (const contact of contacts) {
    const type = effectiveType(contact);
    if (type === "client") clients += 1;
    else if (type === "lead") leads += 1;
    if (miscalledClient(contact)) miscalled += 1;
    if (hasBeenBilled(contact) && !hasPaid(contact)) billedUnpaid += 1;
  }

  return { clients, leads, miscalled, billedUnpaid };
}

/** The line above the contact book. */
export function bookLine(summary: BookSummary): string {
  const parts: string[] = [
    `${summary.clients} ${summary.clients === 1 ? "client" : "clients"}`,
    `${summary.leads} ${summary.leads === 1 ? "lead" : "leads"}`,
  ];
  if (summary.billedUnpaid > 0) {
    parts.push(`${summary.billedUnpaid} billed with no payment recorded`);
  }
  return `${parts.join(", ")}. A client is somebody we have billed or been paid by.`;
}

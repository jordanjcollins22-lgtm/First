/**
 * Who counts as a client.
 *
 * A client is somebody who has paid us. Everyone else is a lead, however
 * warm, however many quotes they have had, however long they have been on
 * the books. That is not a labelling preference: a book where a thousand
 * people are called clients is a book where the word carries no information,
 * and every count built on it — how many clients, what a client is worth,
 * how many clients came from flyers — is measuring something else.
 *
 * So it is derived from the money rather than typed on a form. Nobody has to
 * remember to change it, it cannot be wrong, and the first payment somebody
 * makes turns them into a client everywhere at once.
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
  /** What the office typed on their record, where they typed anything. */
  contactType: string | null;
}

/** Paid us anything at all. */
export function hasPaid(money: ContactMoney): boolean {
  return money.paidCents > 0;
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
  return hasPaid(money) ? "client" : "lead";
}

/** True where the stored type says client and the money does not agree. Worth
 * knowing on a screen that is about to be used to decide who to ring. */
export function miscalledClient(money: ContactMoney): boolean {
  return money.contactType === "client" && !hasPaid(money);
}

export interface BookSummary {
  clients: number;
  leads: number;
  /** Rows the book calls clients that have never paid a penny. */
  miscalled: number;
}

export function summariseBook(contacts: ContactMoney[]): BookSummary {
  let clients = 0;
  let leads = 0;
  let miscalled = 0;

  for (const contact of contacts) {
    const type = effectiveType(contact);
    if (type === "client") clients += 1;
    else if (type === "lead") leads += 1;
    if (miscalledClient(contact)) miscalled += 1;
  }

  return { clients, leads, miscalled };
}

/** The line above the contact book. */
export function bookLine(summary: BookSummary): string {
  const parts: string[] = [];
  parts.push(`${summary.clients} ${summary.clients === 1 ? "client" : "clients"}`);
  parts.push(`${summary.leads} ${summary.leads === 1 ? "lead" : "leads"}`);
  const line = parts.join(", ");
  return summary.clients === 0
    ? `${line}. A client is somebody who has paid us.`
    : `${line}. A client is somebody who has paid us.`;
}

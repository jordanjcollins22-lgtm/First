/**
 * Finding one person in the book.
 *
 * The list was a scroll, which is fine at fifty contacts and useless at three
 * thousand. Everything somebody would type is searched: the name, the email,
 * the phone, and the addresses, because "who was the Elm Road one" is how
 * people actually remember a customer.
 *
 * Pure, so the matching can be tested against the awkward cases rather than
 * discovered by somebody failing to find their own client.
 */

import type { ContactRow } from "@/lib/data/contacts";

/** Digits only, so a number types the way it is written or the way it is stored. */
function digits(value: string): string {
  return value.replace(/\D+/g, "");
}

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Everything about a contact worth searching, as one lowercase string.
 *
 * Built per contact rather than per keystroke by the caller where the list is
 * large; at the sizes this book reaches it is cheap either way.
 */
export function haystack(contact: ContactRow): string {
  return [contact.name, contact.email, contact.phone, ...contact.addresses]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * A number too short to mean anything.
 *
 * Without this, "1" matches every contact whose phone number contains a one,
 * which is all of them, and the search looks broken on the first keystroke.
 * Three is enough to be a deliberate search and still allows a ZIP or a house
 * number.
 */
function tooShortToMean(query: string): boolean {
  return /^\d+$/.test(query) && query.length < 3;
}

export function matchesQuery(contact: ContactRow, query: string): boolean {
  const q = normalise(query);
  if (!q) return true;
  if (tooShortToMean(q)) return false;

  // Every word has to appear somewhere, so "jo elm" finds Jo on Elm Road
  // without needing to remember which order they were typed in.
  const hay = haystack(contact);
  const words = q.split(/\s+/).filter(Boolean);

  const phoneDigits = contact.phone ? digits(contact.phone) : "";
  const queryDigits = digits(q);

  // A number typed straight from a phone screen has no spaces in it and
  // would never match a stored "410 555 0000" by text.
  if (queryDigits.length >= 4 && phoneDigits.includes(queryDigits)) return true;

  return words.every((word) => hay.includes(word));
}

export function searchContacts(contacts: ContactRow[], query: string): ContactRow[] {
  const q = normalise(query);
  if (!q) return contacts;
  return contacts.filter((contact) => matchesQuery(contact, q));
}

/** What to say when a search finds nothing, which should name the search. */
export function emptyLabel(query: string): string {
  const q = query.trim();
  return q ? `Nobody matching "${q}".` : "No contacts yet.";
}

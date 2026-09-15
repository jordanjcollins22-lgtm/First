/**
 * Finding the person a payment belongs to.
 *
 * The office knows who paid; the software does not. What it has is whatever
 * the payment arrived with — a name, usually an email, sometimes a phone —
 * and a book of contacts. This ranks that book against what it has, so the
 * likely answer is the first thing on screen and the office taps once rather
 * than reading a list.
 *
 * Ranking, not deciding. Nothing here links anything. An exact email match is
 * as close to certain as this gets and is still only offered, because the
 * cost of a wrong link is somebody's money filed under a stranger.
 *
 * Separate from `contact-search.ts`, which answers what somebody typed. This
 * answers what a payment said, which is a different question with a different
 * best answer.
 */

export interface SearchableContact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

/** What the payment itself said about who was paying. */
export interface PayerHint {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface RankedContact extends SearchableContact {
  score: number;
  /** Why this one is being offered, in words the office can check. */
  reason: string;
}

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** Digits only, so (410) 555-0123 and 4105550123 are the same phone. */
export function digitsOf(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

/** The last ten, so a leading 1 does not make two numbers look different. */
function phoneKey(v: string | null | undefined): string {
  const d = digitsOf(v);
  return d.length > 10 ? d.slice(-10) : d;
}

/**
 * How well a contact answers to what the payment said, 0 to 100.
 *
 * Email outranks everything: it is the one field a person types themselves and
 * two people rarely share one. Phone is next. A name on its own scores enough
 * to be offered and never enough to look certain, because a county has more
 * than one Dave Miller and filing money on the wrong one is worse than leaving
 * it unfiled.
 */
export function scoreAgainstPayer(contact: SearchableContact, payer: PayerHint): RankedContact {
  const email = norm(payer.email);
  const phone = phoneKey(payer.phone);
  const name = norm(payer.name);

  if (email && norm(contact.email) === email) {
    return { ...contact, score: 100, reason: "Same email as the payment" };
  }
  if (phone && phoneKey(contact.phone) === phone) {
    return { ...contact, score: 90, reason: "Same phone as the payment" };
  }
  if (name && norm(contact.name) === name) {
    return { ...contact, score: 60, reason: "Same name as the payment" };
  }
  if (name && contact.name && sharesSurname(norm(contact.name), name)) {
    return { ...contact, score: 30, reason: "Same last name" };
  }
  return { ...contact, score: 0, reason: "" };
}

/** Both names end in the same word, and it is a word rather than an initial. */
function sharesSurname(a: string, b: string): boolean {
  const lastA = a.split(/\s+/).filter(Boolean).at(-1) ?? "";
  const lastB = b.split(/\s+/).filter(Boolean).at(-1) ?? "";
  return lastA.length > 2 && lastA === lastB;
}

/**
 * The contacts worth offering for a payment, best first.
 *
 * Anything scoring nothing is left out entirely. A list padded with contacts
 * that match on nothing invites somebody to tap one.
 */
export function suggestForPayer(
  contacts: SearchableContact[],
  payer: PayerHint,
  limit = 5
): RankedContact[] {
  return contacts
    .map((c) => scoreAgainstPayer(c, payer))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || (a.name ?? "").localeCompare(b.name ?? ""))
    .slice(0, limit);
}

/**
 * Whether a suggestion is firm enough to put behind a single button.
 *
 * Email or phone only. A name match gets offered in the list like the rest.
 */
export function isConfident(match: RankedContact): boolean {
  return match.score >= 90;
}

/** What a typed query should look for, once. Blank means do not search. */
export function payerSearchTerm(raw: string): string | null {
  const term = raw.trim();
  // One character matches most of the book and costs a round trip to prove it.
  return term.length >= 2 ? term : null;
}

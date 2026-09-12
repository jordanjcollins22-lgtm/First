/**
 * What kind of person a contact is.
 *
 * The app had one shelf and assumed everybody on it was a client. That held
 * while the only way in was booking an evaluation, and stops holding the
 * moment a CRM export arrives carrying the stone yard, the tree crew and the
 * realtor who sends work.
 *
 * The distinction that matters is not "how do we file them" but "does this
 * person belong in a list of our clients". Everything else — the labels, the
 * icons, the order — is presentation. That one question is a function, used
 * everywhere, so no screen has to remember the rule.
 */

export type ContactType =
  | "client"
  | "lead"
  | "supplier"
  | "subcontractor"
  | "referral_partner"
  | "business"
  | "other";

export const CONTACT_TYPES: { value: ContactType; label: string; blurb: string }[] = [
  { value: "client", label: "Client", blurb: "Somebody we have worked for, or are working for now." },
  { value: "lead", label: "Lead", blurb: "Somebody who has been in touch but hasn't bought yet." },
  { value: "supplier", label: "Supplier", blurb: "Nurseries, stone yards, rental, fuel — people we buy from." },
  { value: "subcontractor", label: "Subcontractor", blurb: "Tree crews, hardscape, irrigation — people we sub work to." },
  {
    value: "referral_partner",
    label: "Referral partner",
    blurb: "Realtors, property managers, builders — people who send us work.",
  },
  {
    value: "business",
    label: "Business",
    blurb: "Local businesses we approach about advertising on the flyer.",
  },
  { value: "other", label: "Unsorted", blurb: "Not decided yet. Kept out of client lists until it is." },
];

const LABELS = new Map(CONTACT_TYPES.map((t) => [t.value, t.label]));

export function contactTypeLabel(value: string): string {
  return LABELS.get(value as ContactType) ?? "Unsorted";
}

export function isContactType(value: string): value is ContactType {
  return CONTACT_TYPES.some((t) => t.value === value);
}

/**
 * The types that belong in a list of people who might buy from us.
 *
 * Leads count: somebody who rang last spring and never booked is still a
 * customer record we would want to see when picking who a job is for. The
 * trade does not, and neither does "unsorted" — an undecided row is kept out
 * until somebody decides, because the cost of a supplier appearing in a client
 * picker is worse than the cost of having to sort them.
 */
export const CLIENT_SIDE_TYPES: ContactType[] = ["client", "lead"];

export function isClientSide(type: string | null | undefined): boolean {
  return CLIENT_SIDE_TYPES.includes((type ?? "client") as ContactType);
}

/**
 * The trade: people we work with rather than for.
 *
 * Worth its own group because the question "who do I ring about stone" is a
 * real one, and answering it by scrolling past four hundred homeowners is why
 * everybody keeps that list in their phone instead.
 */
export const TRADE_TYPES: ContactType[] = ["supplier", "subcontractor", "referral_partner"];

export function isTrade(type: string | null | undefined): boolean {
  return TRADE_TYPES.includes((type ?? "") as ContactType);
}

/**
 * What an existing row should be treated as when nobody has said.
 *
 * Every contact that predates this was created by somebody booking a job or an
 * evaluation, so client is the honest default rather than a hopeful one — and
 * defaulting them to unsorted would empty every client list in the app on the
 * day the migration ran.
 */
export const DEFAULT_CONTACT_TYPE: ContactType = "client";

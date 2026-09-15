/**
 * Adding, changing and removing a contact.
 *
 * The rules live here rather than in the form so the server can apply exactly
 * what the UI shows, and so the one that matters — when a contact may be
 * deleted — is testable without a database.
 */

import { normalizeEmail, normalizePhone } from "@/lib/dedupe";
import { isContactType } from "@/lib/contact-types";

export interface ContactInput {
  name: string;
  email: string | null;
  phone: string | null;
  /** What they are to us. Defaults to a lead, which is what a typed-in
   * contact almost always is: somebody who rang, not somebody who has bought. */
  contactType?: string | null;
  /** Where they heard about us. Free text, because the real answers never fit
   * a list: "Ruth next door", "the sign on Route 24", "saw the truck". */
  source?: string | null;
  /**
   * Their property, when there is one.
   *
   * The reason a typed-in contact was nearly useless before: a person with no
   * address cannot have a property, and without a property they cannot have a
   * job, so nothing could ever be booked for them. Somebody entering a phone
   * call has the address in front of them, and asking for it here saves
   * entering the same person twice.
   */
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

const OK: Verdict = { ok: true };

/**
 * Trims and normalises what somebody typed.
 *
 * Blank strings become null rather than empty text, so a contact with no email
 * reads as having none instead of having one that is nothing — which matters
 * because the duplicate finder treats a blank as "unknown" and an empty string
 * as a value it could match on.
 */
export function cleanContact(input: ContactInput): ContactInput {
  const type = (input.contactType ?? "").trim();
  return {
    name: input.name.trim(),
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    contactType: isContactType(type) ? type : null,
    source: input.source?.trim() || null,
    address: input.address?.trim() || null,
    lat: Number.isFinite(input.lat) ? Number(input.lat) : null,
    lng: Number.isFinite(input.lng) ? Number(input.lng) : null,
  };
}

/**
 * Whether an address can become a property.
 *
 * A property row cannot exist without coordinates, so an address typed out and
 * never picked from the suggestions has nowhere to go. Said out loud rather
 * than dropped, because a contact silently saved without the address somebody
 * just typed is the kind of thing found out three weeks later.
 */
export function addressIsPlaceable(input: ContactInput): Verdict {
  const clean = cleanContact(input);
  if (!clean.address) return OK;
  if (clean.lat == null || clean.lng == null) {
    return { ok: false, reason: "Pick the address from the suggestions so we can place it on the map." };
  }
  return OK;
}

export function validateContact(input: ContactInput): Verdict {
  const clean = cleanContact(input);
  if (!clean.name) return { ok: false, reason: "A contact needs a name." };
  if (clean.name.length > 200) return { ok: false, reason: "That name is too long." };

  if (clean.email && !clean.email.includes("@")) {
    return { ok: false, reason: "That doesn't look like an email address." };
  }
  // Ten digits is a US number; the normaliser drops the country code and any
  // punctuation first, so this is about substance rather than formatting.
  if (clean.phone && normalizePhone(clean.phone).length < 10) {
    return { ok: false, reason: "That phone number looks too short." };
  }
  return OK;
}

export interface ContactAttachments {
  propertyCount: number;
  jobCount: number;
}

/**
 * Whether a contact can be deleted.
 *
 * A contact with properties has jobs, proposals, photos and messages hanging
 * off them, and deleting the top of that chain takes the lot. Refusing is not
 * caution for its own sake — it is the difference between removing a
 * mistyped duplicate and losing a season of work on a real client. Merge is
 * the right tool for the second case, and the message says so.
 */
export function canDeleteContact(attachments: ContactAttachments): Verdict {
  if (attachments.jobCount > 0) {
    return {
      ok: false,
      reason: `This contact has ${attachments.jobCount} job${
        attachments.jobCount === 1 ? "" : "s"
      } on file. Merge them into the right contact instead — deleting would take the jobs with them.`,
    };
  }
  if (attachments.propertyCount > 0) {
    return {
      ok: false,
      reason: `This contact has ${attachments.propertyCount} propert${
        attachments.propertyCount === 1 ? "y" : "ies"
      } on file. Remove the propert${
        attachments.propertyCount === 1 ? "y" : "ies"
      } first, or merge this contact into another.`,
    };
  }
  return OK;
}

/** Whether two contacts are the same person by the details given. Used to
 * fold a re-entered contact into the existing one rather than making a
 * second. */
export function looksLikeSamePerson(
  a: Pick<ContactInput, "name" | "email" | "phone">,
  b: Pick<ContactInput, "name" | "email" | "phone">
): boolean {
  const emailA = a.email ? normalizeEmail(a.email) : "";
  const emailB = b.email ? normalizeEmail(b.email) : "";
  if (emailA && emailA === emailB) return true;

  const phoneA = a.phone ? normalizePhone(a.phone) : "";
  const phoneB = b.phone ? normalizePhone(b.phone) : "";
  if (phoneA.length >= 10 && phoneA === phoneB) return true;

  return false;
}

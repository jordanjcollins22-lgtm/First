/**
 * Sorting the posts the browser reads: who wants work done, and who is
 * selling it.
 *
 * Every post read goes through one call, a batch at a time. A request is
 * a lead and goes to the top of the owner's pile. A promotion is somebody
 * advertising their own work: it leaves the pile, and the business's
 * details, as written in the post, are kept as a possible subcontractor.
 * Anything else stays in the pile under "other".
 *
 * Nothing here calls anything. The schema, the brief, and the tidying of
 * what comes back live here so they can be tested without a key.
 */

import { z } from "zod/v4";

export type PostKind = "request" | "promotion" | "other";

export const BusinessSchema = z.object({
  name: z.string().nullable(),
  person: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  services: z.array(z.string()),
  area: z.string().nullable(),
});

export const SortedPostSchema = z.object({
  id: z.string(),
  kind: z.enum(["request", "promotion", "other"]),
  business: BusinessSchema.nullable(),
});

export const SortResultSchema = z.object({
  posts: z.array(SortedPostSchema),
});

export type SortedPost = z.infer<typeof SortedPostSchema>;
export type BusinessDetails = z.infer<typeof BusinessSchema>;

export interface PostToSort {
  id: string;
  author: string | null;
  group: string | null;
  text: string;
}

export const SORT_SYSTEM_PROMPT = [
  "You sort posts from local community Facebook groups in and around Harford County, Maryland, for a landscaping and lawn care company.",
  "",
  "For each post, decide its kind:",
  '- "request": the poster wants work done at their own home or property, or is asking who to hire, or asks for recommendations for a service. Any trade counts, not only landscaping. Posts that only imply it count too, like complaining about an overgrown yard and asking what people do about it.',
  '- "promotion": the poster is advertising their own services, business, availability, prices, or page. A person offering to do work for others is a promotion, even when they phrase it casually ("I have openings for mowing this fall, DM me").',
  '- "other": anything else, including thank-you posts, somebody saying they found a person, news, lost pets, and general chat.',
  "",
  'When one post both asks and advertises, decide by who would be paying: the poster paying for work is a "request"; the poster wanting to be paid is a "promotion".',
  "",
  'For a "promotion" only, fill in "business" with the details written in the post and nothing else: the business name, the person\'s name, phone, email, website, the services they offer in a few words each, and the towns or area they mention. Use null for anything not written in the post, and an empty list when no services are named. Never invent or guess a phone number, email, or website.',
  'For "request" and "other", set "business" to null.',
  "",
  'Return one entry per post, with the same "id" it was given, and no others.',
].join("\n");

/** The user message: every post, numbered by its id, in one block. */
export function sortBrief(posts: readonly PostToSort[]): string {
  const blocks = posts.map((post) =>
    [
      `<post id="${post.id}">`,
      post.author ? `Posted by: ${post.author}` : "Posted by: unknown",
      post.group ? `Group: ${post.group}` : null,
      post.text.slice(0, 2000),
      "</post>",
    ]
      .filter(Boolean)
      .join("\n")
  );
  return [`Sort these ${posts.length} posts.`, "", ...blocks].join("\n\n");
}

/** Digits of a phone number, the last ten, when there are at least seven. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "").slice(-10);
  return digits.length >= 7 ? digits : null;
}

/** A readable phone number, when it is a US one. */
export function formatPhone(phone: string | null | undefined): string | null {
  const key = phoneKey(phone);
  if (!key) return phone?.trim() || null;
  if (key.length === 10) return `${key.slice(0, 3)}-${key.slice(3, 6)}-${key.slice(6)}`;
  return key;
}

function cleanEmail(email: string | null | undefined): string | null {
  const value = (email ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

function cleanName(value: string | null | undefined, max = 120): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

/**
 * One name for one business, whichever post it came from.
 *
 * The phone first, because it survives a business being called three
 * different things; then the email; then the business name; then the
 * person. Nothing at all to go on means nothing is kept.
 */
export function businessKey(details: { phone?: string | null; email?: string | null; name?: string | null; person?: string | null }): string | null {
  const phone = phoneKey(details.phone);
  if (phone) return `phone:${phone}`;
  const email = cleanEmail(details.email);
  if (email) return `email:${email}`;
  const name = (details.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(llc|inc|co|company|services?|the)\b/g, "").trim();
  if (name.length >= 3) return `name:${name}`;
  const person = (details.person ?? "").toLowerCase().replace(/[^a-z ]+/g, "").trim();
  if (person.length >= 3) return `person:${person}`;
  return null;
}

/** The details tidied: trimmed, bounded, email checked, phone formatted, services deduplicated. */
export function tidyBusiness(details: BusinessDetails, fallbackPerson: string | null): BusinessDetails {
  const services = Array.from(
    new Set((details.services ?? []).map((s) => cleanName(s, 60)).filter((s): s is string => Boolean(s)).map((s) => s.toLowerCase()))
  ).slice(0, 12);
  const website = cleanName(details.website, 200);
  return {
    name: cleanName(details.name),
    person: cleanName(details.person) ?? cleanName(fallbackPerson, 80),
    phone: formatPhone(details.phone),
    email: cleanEmail(details.email),
    website: website && /\.[a-z]{2,}/i.test(website) ? website : null,
    services,
    area: cleanName(details.area, 160),
  };
}

/**
 * The answer, kept only where it matches a post that was asked about.
 *
 * An id the model made up is dropped, and a post it skipped is left
 * unsorted rather than guessed at, so it is asked about again next time.
 */
export function matchSorted(asked: readonly PostToSort[], answer: readonly SortedPost[]): Map<string, SortedPost> {
  const ids = new Set(asked.map((post) => post.id));
  const out = new Map<string, SortedPost>();
  for (const row of answer) {
    if (ids.has(row.id) && !out.has(row.id)) out.set(row.id, row);
  }
  return out;
}

/**
 * Sorting the posts the browser reads into two piles: the ones for us, and
 * everything else, kept as data.
 *
 * For us means a real person near here wants to pay for work this business
 * does, or arranges through a partner, and is still looking. Those go on
 * the affiliates' board. Everything else is kept with what kind of post it
 * is, what service it is about and which town, so the data says what people
 * in the area ask for, without anybody wading through it. A business
 * advertising its own work is kept as a possible subcontractor.
 *
 * The sorter is told what this business does and where, and shown the
 * team's own recent calls on posts, so it sorts the way they would.
 *
 * Nothing here calls anything. The schema, the brief, and the tidying of
 * what comes back live here so they can be tested without a key.
 */

import { z } from "zod/v4";

export type PostKind = "request" | "promotion" | "other";

/** What kind of post it is, for the data. Only "for-us" goes on the board. */
export const POST_CATEGORIES = [
  { key: "for-us", label: "Asking for our work" },
  { key: "other-trade", label: "Asking for another trade" },
  { key: "business-ad", label: "Business advertising" },
  { key: "hiring", label: "Hiring or looking for work" },
  { key: "yard-question", label: "Yard question, not hiring" },
  { key: "found", label: "Already found someone" },
  { key: "community", label: "Community chat" },
] as const;

export type PostCategory = (typeof POST_CATEGORIES)[number]["key"];

export function categoryLabel(key: string | null | undefined): string {
  return POST_CATEGORIES.find((c) => c.key === key)?.label ?? "Not sorted yet";
}

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
  category: z.enum(["for-us", "other-trade", "business-ad", "hiring", "yard-question", "found", "community"]),
  /** Our own service name when it is one of ours, otherwise a short name for the work. */
  service: z.string().nullable(),
  town: z.string().nullable(),
  /** A few words on why. */
  reason: z.string(),
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

/** One of the team's own calls on a post, shown to the sorter as an example. */
export interface SortExample {
  text: string;
  forUs: boolean;
  /** What the team said, when they said why. */
  why: string | null;
}

export interface SortContext {
  ownServices: string[];
  partnerServices: string[];
  /** Towns and zip codes that are near here. */
  areaWords: string[];
  examples: SortExample[];
}

/**
 * The sorter's instructions, with what this business does and where.
 *
 * "For us" is deliberately narrow: an affiliate's time answering a post
 * about pizza, a plumber, or a lawn somebody already found a crew for is
 * time not spent on one that could book.
 */
export function sortSystemPrompt(context: SortContext): string {
  const own = context.ownServices.filter(Boolean);
  const partner = context.partnerServices.filter(Boolean);
  const lines = [
    "You sort posts from local community Facebook groups in and around Harford County, Maryland, for a landscaping and lawn care company.",
    "",
    own.length > 0 ? `Our own crew does: ${own.join(", ")}.` : "Our own crew does lawn care and landscaping.",
    partner.length > 0 ? `We arrange through trusted partners: ${partner.join(", ")}.` : null,
    context.areaWords.length > 0 ? `We work in and around: ${context.areaWords.join(", ")}.` : null,
    "",
    "For each post decide:",
    "",
    '1. "category", exactly one of:',
    '- "for-us": a person wants to pay someone for work at a home or property that we do or arrange (the lists above, or plainly the same kind of outdoor property work), is still looking, and is not clearly far from our area. Asking who to hire, asking for recommendations, asking for quotes, or describing a yard problem and asking who can fix it all count.',
    '- "other-trade": a person wants to hire for work we neither do nor arrange (plumbing, roofing, HVAC, electrical, cleaning inside the house, cars, pets, childcare, and so on), or wants a recommendation for a restaurant, shop or other business.',
    '- "business-ad": somebody advertising their own business, services, availability, products, events or things for sale.',
    '- "hiring": a business looking for workers, or a person looking for a job.',
    '- "yard-question": a lawn, garden or yard question asking for advice to do it themselves, with no sign of wanting to hire anyone.',
    '- "found": the poster already has somebody, says thanks for the recommendations, or the job is done.',
    '- "community": everything else: news, politics, events, lost pets, questions and chat.',
    "",
    '2. "kind": "request" when the poster wants to pay for work of any trade (for-us and other-trade), "promotion" for a business-ad, and "other" for the rest.',
    '3. "service": when category is for-us and the work matches one of our services, that service\'s name exactly as written above; otherwise a short plain name for the work ("Plumbing", "Pizza"), or null for chat.',
    '4. "town": the town or area named in the post or group, or null.',
    '5. "reason": a few words on why, like "wants front beds mulched in Bel Air" or "asking for a roofer".',
    "",
    'When one post both asks and advertises, decide by who would be paying: the poster paying for work is asking; the poster wanting to be paid is a business-ad. When unsure whether it is for us, say for-us only if it is outdoor property work somebody would pay for.',
    "",
    'For a business-ad only, fill in "business" with the details written in the post and nothing else: the business name, the person\'s name, phone, email, website, the services they offer in a few words each, and the towns or area they mention. Use null for anything not written in the post, and an empty list when no services are named. Never invent or guess a phone number, email, or website. For every other category set "business" to null.',
  ];
  if (context.examples.length > 0) {
    lines.push("", "How our team has sorted posts recently. Sort the same way:");
    for (const example of context.examples) {
      lines.push(`- "${example.text.replace(/\s+/g, " ").slice(0, 160)}" -> ${example.forUs ? "for us" : "not for us"}${example.why ? ` (${example.why})` : ""}`);
    }
  }
  lines.push("", 'Return one entry per post, with the same "id" it was given, and no others.');
  return lines.filter((line): line is string => line !== null).join("\n");
}

/**
 * Where a sorted post goes. On the board only when it is for us and a
 * request both: the two have to agree, so a slip in one does not send a
 * pizza question to the affiliates.
 */
export function kindFor(verdict: Pick<SortedPost, "kind" | "category">): PostKind {
  if (verdict.category === "for-us" && verdict.kind === "request") return "request";
  if (verdict.category === "business-ad" || verdict.kind === "promotion") return "promotion";
  return "other";
}

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

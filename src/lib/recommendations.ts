/**
 * Answering somebody who asked for a landscaper, and knowing it worked.
 *
 * A neighbour posts "can anyone recommend a landscaper?" in a Facebook group
 * or on Nextdoor. Somebody on the team replies. That is the cheapest lead this
 * business gets and nothing recorded any of it — not who answered, not where,
 * not which group, and not whether a job came out of it.
 *
 * Two halves. The reply itself has to be easy to write, because a person
 * standing in a garden is not going to compose one; and it has to carry a link
 * that is unique to that reply, because otherwise "which groups are worth
 * answering in" stays a feeling.
 *
 * Nothing here writes anything. It makes codes, builds the words, and adds up
 * what came back.
 */

/**
 * What a screenshot may be, and how big.
 *
 * Here rather than beside the action that uses them. A "use server" module may
 * only export async functions: anything else is rewritten into a reference to
 * a server action, so a client importing this array got something with no
 * `.join` on it and the page died on render.
 */
export const MAX_SHOT_BYTES = 8 * 1024 * 1024;
export const SHOT_TYPES = ["image/png", "image/jpeg", "image/webp"];

export type Platform = "facebook" | "nextdoor" | "instagram" | "reddit" | "other";

export const PLATFORMS: { key: Platform; label: string; groupWord: string }[] = [
  { key: "facebook", label: "Facebook", groupWord: "Group" },
  { key: "nextdoor", label: "Nextdoor", groupWord: "Neighbourhood" },
  { key: "instagram", label: "Instagram", groupWord: "Account or hashtag" },
  { key: "reddit", label: "Reddit", groupWord: "Subreddit" },
  { key: "other", label: "Somewhere else", groupWord: "Where" },
];

export function platformLabel(platform: string): string {
  return PLATFORMS.find((p) => p.key === platform)?.label ?? "Somewhere else";
}

/** What to call the "group" box, since every platform calls it something else. */
export function groupWordFor(platform: string): string {
  return PLATFORMS.find((p) => p.key === platform)?.groupWord ?? "Where";
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/**
 * A short code for one reply.
 *
 * Read aloud badly on purpose: no l, no 1, no 0, no o. These end up typed by
 * somebody squinting at a phone, and a code that cannot be confused is worth
 * more than a code that is one character shorter.
 */
export function makeCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < 7; i += 1) out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return out;
}

/**
 * The link that goes in the post.
 *
 * Carries three things. Which business it is, so the booking page knows whose
 * calendar to open; whose recommendation it was, so the right person gets the
 * credit; and which reply it was, so the group can be counted.
 *
 * The first of those is not optional, and used to be missing. A link with only
 * a reply code on it names nobody, and the booking page has nothing to resolve
 * it against — so anybody without an affiliate link of their own was posting
 * "This booking link isn't valid" into a stranger's Facebook thread, under the
 * business's name, as the one thing the whole feature exists to produce.
 *
 * The affiliate slug goes on top of the org rather than instead of it. Both on
 * the link means it still opens after somebody stops being an affiliate, which
 * is the state a shared link outlives.
 */
export function recommendationLink(input: {
  baseUrl: string;
  /** The business's public booking slug. Without it the link resolves to nobody. */
  orgSlug: string | null;
  affiliateSlug: string | null;
  code: string;
}): string {
  const base = input.baseUrl.replace(/\/$/, "");
  const params = new URLSearchParams();
  if (input.orgSlug) params.set("org", input.orgSlug);
  if (input.affiliateSlug) params.set("ref", input.affiliateSlug);
  params.set("rec", input.code);
  return `${base}/book?${params.toString()}`;
}

/** What the business can honestly say about itself in a stranger's thread. */
export interface Boasts {
  businessName: string;
  /** "featured on WBAL", or null when there is nothing true to say. */
  newsMention: string | null;
  /** Shown only when there are enough to mean something. */
  reviewCount: number | null;
  reviewStars: number | null;
}

export interface PostDraft {
  /** A name for the tone, so somebody can pick rather than read all three. */
  tone: string;
  text: string;
}

/**
 * Three ways to say it, so ten replies in one group do not read as a bot.
 *
 * Short first, because that is the one that gets used. Every claim comes from
 * the caller — nothing here invents a review count or a television
 * appearance, and a claim with nothing behind it is left out of the sentence
 * rather than written as an empty phrase.
 */
export function draftPosts(boasts: Boasts, link: string): PostDraft[] {
  const name = boasts.businessName.trim() || "us";
  const reviews = reviewPhrase(boasts);
  const news = boasts.newsMention?.trim() ? boasts.newsMention.trim() : null;

  const short = [
    `We use ${name} and they've been great.`,
    reviews ? `${sentenceCase(reviews)}.` : null,
    `They'll come out and give you a free quote — you can book straight in here: ${link}`,
  ]
    .filter(Boolean)
    .join(" ");

  const warm = [
    `Happy to recommend ${name}.`,
    `They did our place and the crew turned up when they said they would, which is half the battle.`,
    news ? `They were ${news}.` : null,
    reviews ? `${sentenceCase(reviews)}.` : null,
    `Free evaluation, no pressure — here's the link: ${link}`,
  ]
    .filter(Boolean)
    .join(" ");

  const plain = [
    `${name} — ${link}`,
    news ? `${sentenceCase(news)}.` : null,
    reviews ? `${sentenceCase(reviews)}.` : null,
    `They do a free walkthrough and give you a written price.`,
  ]
    .filter(Boolean)
    .join(" ");

  return [
    { tone: "Short", text: short },
    { tone: "Warmer", text: warm },
    { tone: "Just the link", text: plain },
  ];
}

/**
 * The reviews line, or nothing.
 *
 * A handful of reviews is not a boast, and "rated 5 stars by 3 people" reads
 * worse than saying nothing at all.
 */
function reviewPhrase(boasts: Boasts): string | null {
  const count = boasts.reviewCount ?? 0;
  const stars = boasts.reviewStars ?? 0;
  if (count < 10 || stars < 4.5) return null;
  return `they're ${stars.toFixed(1)} stars across ${count} reviews`;
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// What came of it
// ---------------------------------------------------------------------------

export interface RecommendationRow {
  id: string;
  code: string;
  platform: Platform;
  groupName: string | null;
  profileId: string;
  postedAt: string;
}

export interface GroupTally {
  platform: Platform;
  groupName: string;
  posts: number;
  /** Bookings that arrived carrying one of this group's codes. */
  bookings: number;
  /** Bookings per post, for comparing a group of six posts with one of sixty. */
  rate: number;
}

/**
 * Which groups are worth answering in.
 *
 * Counted by group rather than by platform, because "Facebook works" is not
 * something anybody can act on and "the Bel Air Community group converts one
 * in three" is. A group with no name is still counted, under the platform, so
 * replies nobody labelled do not vanish.
 *
 * Ordered by bookings, not by rate. One booking from twenty posts beats a
 * perfect record from one, and a rate on a single post is not a rate.
 */
export function tallyByGroup(
  rows: RecommendationRow[],
  bookedCodes: Iterable<string>
): GroupTally[] {
  const booked = new Set(bookedCodes);
  const tallies = new Map<string, GroupTally>();

  for (const row of rows) {
    const groupName = (row.groupName ?? "").trim() || `${platformLabel(row.platform)} — no group named`;
    const key = `${row.platform}::${groupName.toLowerCase()}`;
    const tally = tallies.get(key) ?? {
      platform: row.platform,
      groupName,
      posts: 0,
      bookings: 0,
      rate: 0,
    };
    tally.posts += 1;
    if (booked.has(row.code)) tally.bookings += 1;
    tallies.set(key, tally);
  }

  return Array.from(tallies.values())
    .map((tally) => ({ ...tally, rate: tally.posts > 0 ? tally.bookings / tally.posts : 0 }))
    .sort((a, b) => b.bookings - a.bookings || b.posts - a.posts || a.groupName.localeCompare(b.groupName));
}

/** Who has answered the most, and what came of it. */
export interface PersonTally {
  profileId: string;
  posts: number;
  bookings: number;
}

export function tallyByPerson(
  rows: RecommendationRow[],
  bookedCodes: Iterable<string>
): PersonTally[] {
  const booked = new Set(bookedCodes);
  const tallies = new Map<string, PersonTally>();
  for (const row of rows) {
    const tally = tallies.get(row.profileId) ?? { profileId: row.profileId, posts: 0, bookings: 0 };
    tally.posts += 1;
    if (booked.has(row.code)) tally.bookings += 1;
    tallies.set(row.profileId, tally);
  }
  return Array.from(tallies.values()).sort((a, b) => b.bookings - a.bookings || b.posts - a.posts);
}

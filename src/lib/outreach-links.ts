/**
 * Every link the business hands out, and what came back.
 *
 * One reply under a stranger's post, one scheduled page post, one DM, one
 * affiliate link on a flyer. They are the same question in four costumes:
 * where did this go, who saw it, did anybody click, did anybody reply, did
 * anybody book. Answered by four separate things they would drift, and the
 * answer that drifted would be whichever nobody was watching.
 *
 * So there is one code per thing handed out, it goes in the link, and
 * everything afterwards is collected against it. A reply nobody clicked is not
 * a reply that failed to sell: it is a group that does not read comments,
 * which is a different decision.
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
 * Short, and a route of its own, and both of those are the point. Short means
 * it survives being pasted into a comment box without wrapping or being
 * trimmed. A route of its own means every open passes through us, which is the
 * only way to learn that a group never clicks before deciding to keep
 * answering in it.
 *
 * The code is the whole address. It already knows its business, its sender and
 * its audience, so nothing else has to ride in the URL where somebody can lose
 * it by tidying up the ugly bit on the end.
 */
export function trackedLink(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/$/, "")}/r/${code}`;
}

/**
 * Where a tracked link sends somebody.
 *
 * Built here rather than inside the route, so its shape can be checked without
 * a request. Carries which business it is, so the booking page knows whose
 * calendar to open; who gets the credit; and which handed-out link it was, so
 * a booking counts back to it.
 *
 * The organisation is not optional, and used to be missing. A link naming
 * nobody gave the booking page nothing to resolve, so anybody without an
 * affiliate link of their own was posting "This booking link isn't valid" into
 * a stranger's thread under the business's name. The affiliate slug goes on
 * top of the organisation rather than instead of it, because a shared link
 * outlives whoever shared it.
 */
export function bookingDestination(input: {
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

/**
 * What carried the link.
 *
 * A post goes to a whole audience and a comment goes to one person, so
 * counting them together would make a page post look a hundred times worse at
 * converting than a reply. Separated for that reason and no other.
 */
export type OutreachKind = "comment" | "post" | "dm" | "flyer" | "sign" | "other";

export const OUTREACH_KINDS: { key: OutreachKind; label: string; oneTo: "person" | "audience" }[] = [
  { key: "comment", label: "Comment on a post", oneTo: "person" },
  { key: "post", label: "A post of ours", oneTo: "audience" },
  { key: "dm", label: "Direct message", oneTo: "person" },
  { key: "flyer", label: "Flyer or door hanger", oneTo: "audience" },
  { key: "sign", label: "Sign", oneTo: "audience" },
  { key: "other", label: "Something else", oneTo: "audience" },
];

export function kindLabel(kind: string): string {
  return OUTREACH_KINDS.find((k) => k.key === kind)?.label ?? "Something else";
}

/** Whether this went to one named person, who can be asked whether they replied. */
export function goesToOnePerson(kind: string): boolean {
  return OUTREACH_KINDS.find((k) => k.key === kind)?.oneTo === "person";
}

/**
 * What came back from the person, where there was one person.
 *
 * Set by hand and only by hand. Nothing can see a reply on Facebook, and
 * guessing would be worse than asking: a lead marked ignored because a scraper
 * missed a comment is a lead nobody ever follows up.
 */
export type OutreachResponse = "replied" | "no reply" | "not interested" | "hostile";

export const RESPONSES: { key: OutreachResponse; label: string }[] = [
  { key: "replied", label: "They replied" },
  { key: "no reply", label: "No reply" },
  { key: "not interested", label: "Not interested" },
  { key: "hostile", label: "Told off for posting" },
];

export function responseLabel(response: string | null): string | null {
  return RESPONSES.find((r) => r.key === response)?.label ?? null;
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

export interface OutreachRow {
  id: string;
  code: string;
  kind: OutreachKind;
  platform: Platform;
  /** The group, neighbourhood, subreddit or feed it landed in. */
  audience: string | null;
  /** Which of our pages or accounts it went out from, on a post of ours. */
  fromPage: string | null;
  /** Who it was aimed at, where it was aimed at one person. */
  sentTo: string | null;
  profileId: string;
  postedAt: string;
  clickCount: number;
  response: OutreachResponse | null;
}

/**
 * One row of the funnel, at whatever level it is being counted.
 *
 * Four numbers in the order they happen, because that order is the whole
 * point. Posts that get no clicks and posts that get clicks but no bookings
 * are different problems with different fixes: the first is the wrong room,
 * the second is the wrong words.
 */
export interface Funnel {
  /** Links handed out. */
  posts: number;
  /** How many of those were opened at least once. */
  clicked: number;
  /** Every open, including somebody coming back twice. */
  clicks: number;
  /** Where somebody was asked and said something back. */
  replied: number;
  /** Bookings that arrived carrying one of these codes. */
  bookings: number;
}

const EMPTY: Funnel = { posts: 0, clicked: 0, clicks: 0, replied: 0, bookings: 0 };

function add(funnel: Funnel, row: OutreachRow, booked: Set<string>): Funnel {
  return {
    posts: funnel.posts + 1,
    clicked: funnel.clicked + (row.clickCount > 0 ? 1 : 0),
    clicks: funnel.clicks + Math.max(0, row.clickCount),
    replied: funnel.replied + (row.response === "replied" ? 1 : 0),
    bookings: funnel.bookings + (booked.has(row.code) ? 1 : 0),
  };
}

/** Bookings per link handed out. Null below a handful, where it is noise. */
export function bookingRate(funnel: Funnel, floor = 5): number | null {
  if (funnel.posts < floor) return null;
  return funnel.bookings / funnel.posts;
}

/** Opens per link handed out. The first thing that goes wrong, and the
 * cheapest to fix: a room that never clicks is a room to stop posting in. */
export function clickRate(funnel: Funnel, floor = 5): number | null {
  if (funnel.posts < floor) return null;
  return funnel.clicked / funnel.posts;
}

export interface GroupTally extends Funnel {
  platform: Platform;
  audience: string;
}

/**
 * Which rooms are worth being in.
 *
 * Counted by audience rather than by platform, because "Facebook works" is not
 * something anybody can act on and "the Bel Air Community group converts one
 * in three" is. An audience nobody named is still counted, under its platform,
 * so links nobody labelled do not vanish.
 *
 * Ordered by bookings, not by rate. One booking from twenty beats a perfect
 * record from one, and a rate on a single link is not a rate.
 */
export function tallyByGroup(
  rows: readonly OutreachRow[],
  bookedCodes: Iterable<string>
): GroupTally[] {
  const booked = new Set(bookedCodes);
  const tallies = new Map<string, GroupTally>();

  for (const row of rows) {
    const audience = (row.audience ?? "").trim() || `${platformLabel(row.platform)} — nothing named`;
    const key = `${row.platform}::${audience.toLowerCase()}`;
    const found = tallies.get(key) ?? { ...EMPTY, platform: row.platform, audience };
    tallies.set(key, { ...found, ...add(found, row, booked) });
  }

  return Array.from(tallies.values()).sort(
    (a, b) => b.bookings - a.bookings || b.clicked - a.clicked || b.posts - a.posts || a.audience.localeCompare(b.audience)
  );
}

export interface PersonTally extends Funnel {
  profileId: string;
}

/** Who handed out the most, and what came of it. */
export function tallyByPerson(
  rows: readonly OutreachRow[],
  bookedCodes: Iterable<string>
): PersonTally[] {
  const booked = new Set(bookedCodes);
  const tallies = new Map<string, PersonTally>();
  for (const row of rows) {
    const found = tallies.get(row.profileId) ?? { ...EMPTY, profileId: row.profileId };
    tallies.set(row.profileId, { ...found, ...add(found, row, booked) });
  }
  return Array.from(tallies.values()).sort(
    (a, b) => b.bookings - a.bookings || b.clicked - a.clicked || b.posts - a.posts
  );
}

export interface KindTally extends Funnel {
  kind: OutreachKind;
}

/**
 * Comments against posts against flyers.
 *
 * The question this answers is where the next hour goes. A page post that
 * reaches four hundred people and books nobody, next to nine comments that
 * book two, is an argument for spending the morning in the comments.
 */
export function tallyByKind(
  rows: readonly OutreachRow[],
  bookedCodes: Iterable<string>
): KindTally[] {
  const booked = new Set(bookedCodes);
  const tallies = new Map<string, KindTally>();
  for (const row of rows) {
    const found = tallies.get(row.kind) ?? { ...EMPTY, kind: row.kind };
    tallies.set(row.kind, { ...found, ...add(found, row, booked) });
  }
  return Array.from(tallies.values()).sort((a, b) => b.bookings - a.bookings || b.posts - a.posts);
}

export interface PageTally extends Funnel {
  /** One of our pages or accounts. */
  page: string;
}

/**
 * Our own pages, once posts are being scheduled from them.
 *
 * Only counts links that named a page they went out from, so a shop with one
 * Facebook page and no scheduling sees nothing here rather than a row called
 * "unknown" with every comment in it.
 */
export function tallyByPage(
  rows: readonly OutreachRow[],
  bookedCodes: Iterable<string>
): PageTally[] {
  const booked = new Set(bookedCodes);
  const tallies = new Map<string, PageTally>();
  for (const row of rows) {
    const page = (row.fromPage ?? "").trim();
    if (!page) continue;
    const key = page.toLowerCase();
    const found = tallies.get(key) ?? { ...EMPTY, page };
    tallies.set(key, { ...found, ...add(found, row, booked) });
  }
  return Array.from(tallies.values()).sort(
    (a, b) => b.bookings - a.bookings || b.posts - a.posts || a.page.localeCompare(b.page)
  );
}

/** Everything, added up once. */
export function totals(rows: readonly OutreachRow[], bookedCodes: Iterable<string>): Funnel {
  const booked = new Set(bookedCodes);
  return rows.reduce((funnel, row) => add(funnel, row, booked), EMPTY);
}

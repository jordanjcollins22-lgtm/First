/**
 * Running a hyper-local group, and what the app can honestly do about it.
 *
 * The ask was: create local groups in the app, manage them from here, block
 * businesses from posting for free, message them to say they have to pay, and
 * sort the "does anyone know someone who does X" posts automatically.
 *
 * Three of those five are ours. Two are not, and no amount of code changes
 * that:
 *
 * - Facebook discontinued the Groups API on 22 April 2024. There is no
 *   permission left to read a group feed, publish to a group, or approve and
 *   decline a pending post — owning the group does not bring one back. Every
 *   scheduling tool that offered Facebook Groups dropped the feature the same
 *   year for the same reason.
 * - There is no way to message somebody who posted. Messenger only opens a
 *   window once a person has messaged the Page first, and outside that window
 *   only transactional tags and paid sponsored messages exist. A cold "you
 *   have to pay to advertise here" is not either of those.
 *
 * What Facebook does have is Admin Assist, which declines incoming posts on
 * keywords and shows the author a message the admin wrote. That is exactly
 * the blocking half of the ask, done natively — so this file keeps the words
 * and prints the settings to paste in, rather than pretending to an API that
 * was taken away.
 *
 * Everything Facebook was never going to do — what the group charges, who
 * paid, what somebody asked for, and whether a job came of it — is ours, and
 * that is the rest of this file.
 */

export type GroupPlatform = "facebook" | "nextdoor" | "other";

export const GROUP_PLATFORMS: { key: GroupPlatform; label: string }[] = [
  { key: "facebook", label: "Facebook" },
  { key: "nextdoor", label: "Nextdoor" },
  { key: "other", label: "Somewhere else" },
];

/** What a post turned out to be. */
export type PostKind = "request" | "promotion" | "other";

export const POST_KINDS: { key: PostKind; label: string; blurb: string }[] = [
  { key: "request", label: "Asking for work", blurb: "A neighbour wants something done. This is a lead." },
  { key: "promotion", label: "Advertising", blurb: "A business posting for free. This is what a pass is for." },
  { key: "other", label: "Neither", blurb: "Ordinary group chatter. Nothing to do." },
];

export type Urgency = "emergency" | "soon" | "whenever";

export const URGENCIES: { key: Urgency; label: string }[] = [
  { key: "emergency", label: "Right now" },
  { key: "soon", label: "Soon" },
  { key: "whenever", label: "No rush" },
];

/** Sooner first, and anything unsaid last. */
export function urgencyRank(urgency: string | null): number {
  const index = URGENCIES.findIndex((u) => u.key === urgency);
  return index === -1 ? URGENCIES.length : index;
}

// ---------------------------------------------------------------------------
// Telling an advert from a neighbour
// ---------------------------------------------------------------------------

/**
 * The words that mean somebody is selling, in any group anywhere.
 *
 * Deliberately the phrases a business writes about itself rather than the
 * trades themselves. "Mulch" is what a neighbour says when they want mulch;
 * "licensed and insured" is never written by somebody asking for help.
 *
 * A group adds its own on top, because every area sells something different
 * and the ones worth blocking are local.
 */
export const DEFAULT_BLOCK_WORDS: readonly string[] = [
  "licensed and insured",
  "free estimates",
  "free quotes",
  "book now",
  "dm for pricing",
  "dm me for a quote",
  "pm for pricing",
  "call or text for a quote",
  "now booking",
  "taking on new clients",
  "accepting new clients",
  "spots available",
  "openings available",
  "family owned and operated",
  "no job too small",
  "we offer",
  "our services include",
  "discount",
  "special offer",
  "check out our page",
  "like and share",
  "visit our website",
] as const;

/**
 * The words that mean somebody wants something done.
 *
 * Only ever used to sort, never to refuse anything: a neighbour whose post is
 * read wrong loses nothing, where a neighbour whose post is blocked is a
 * neighbour who leaves the group.
 */
const REQUEST_WORDS: readonly string[] = [
  "looking for",
  "does anyone know",
  "anyone know",
  "can anyone recommend",
  "any recommendations",
  "recommendations for",
  "in need of",
  "need someone",
  "need a",
  "who does",
  "who do you use",
  "asking for a friend",
  "quotes for",
  "estimate for",
  "help with",
  "hiring someone",
] as const;

const EMERGENCY_WORDS: readonly string[] = [
  "emergency",
  "urgent",
  "asap",
  "right away",
  "today",
  "tomorrow",
  "storm damage",
  "fell on",
  "came down",
] as const;

const SOON_WORDS: readonly string[] = [
  "this week",
  "next week",
  "soon",
  "before",
  "by the end of",
  "this weekend",
] as const;

/** Case and punctuation folded, so "Licensed & Insured!" matches. */
function fold(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/**
 * Which blocking words this post uses.
 *
 * Returns them rather than a yes or no on purpose. Somebody whose post was
 * declined will ask why, and "your post said 'now booking'" is an answer;
 * "the filter caught it" is the start of an argument.
 */
export function matchedBlockWords(text: string, extra: readonly string[] = []): string[] {
  const haystack = fold(text);
  const words = [...DEFAULT_BLOCK_WORDS, ...extra.map((w) => w.trim()).filter(Boolean)];
  const hits: string[] = [];
  for (const word of words) {
    const needle = fold(word).trim();
    if (!needle) continue;
    if (haystack.includes(` ${needle} `)) hits.push(word);
  }
  return Array.from(new Set(hits));
}

export interface Triage {
  kind: PostKind;
  /** The service asked for, when one of the business's own names fits. */
  service: string | null;
  urgency: Urgency | null;
  matchedWords: string[];
}

/**
 * Sort a post without asking a model.
 *
 * The model reads a screenshot and does this better, but it needs a key, a
 * network and a couple of seconds. This runs on pasted text instantly and for
 * nothing, so it is what the screen shows while the model is still thinking,
 * and what it falls back to when there is no key at all.
 *
 * Advertising is decided before asking for work, because a business post
 * usually names a service too — "now booking spring cleanups" would otherwise
 * read as somebody wanting a spring cleanup.
 */
export function triageLocally(
  text: string,
  options: { blockWords?: readonly string[]; services?: readonly string[] } = {}
): Triage {
  const matchedWords = matchedBlockWords(text, options.blockWords ?? []);
  const haystack = fold(text);

  if (matchedWords.length > 0) {
    return { kind: "promotion", service: null, urgency: null, matchedWords };
  }

  const asking = REQUEST_WORDS.some((word) => haystack.includes(fold(word)));
  if (!asking) return { kind: "other", service: null, urgency: null, matchedWords: [] };

  return {
    kind: "request",
    service: serviceFor(haystack, options.services ?? []),
    urgency: urgencyFor(haystack),
    matchedWords: [],
  };
}

/**
 * The business's own service name, when the post names it.
 *
 * Matched against the services this business actually sells rather than a
 * fixed list, so a lead lands on something a proposal can be built from. A
 * post that names none of them gets null: "Other" as a service is a category
 * nobody ever looks in.
 */
function serviceFor(haystack: string, services: readonly string[]): string | null {
  let best: { name: string; length: number } | null = null;
  for (const name of services) {
    // Match on the words of the service name, so "Leaf / Seasonal Cleanup"
    // is found by a post that says "leaf cleanup".
    const words = fold(name).trim().split(" ").filter((w) => w.length > 3);
    if (words.length === 0) continue;
    const hit = words.some((word) => haystack.includes(` ${word}`));
    if (!hit) continue;
    if (!best || name.length > best.length) best = { name, length: name.length };
  }
  return best?.name ?? null;
}

function urgencyFor(haystack: string): Urgency | null {
  if (EMERGENCY_WORDS.some((word) => haystack.includes(fold(word)))) return "emergency";
  if (SOON_WORDS.some((word) => haystack.includes(fold(word)))) return "soon";
  return null;
}

// ---------------------------------------------------------------------------
// What the group tells a business
// ---------------------------------------------------------------------------

export interface GroupTerms {
  name: string;
  businessPostCents: number | null;
  passDays: number;
  declineMessage: string | null;
}

export function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });
}

/**
 * What a declined business is told.
 *
 * Their own wording where they wrote some, and a workable default where they
 * did not — a group with a blank decline message declines people silently,
 * which reads as the admin being arbitrary.
 *
 * The link is what makes it worth anything. "You have to pay" with nowhere to
 * pay is a rule; "you have to pay, here" is revenue.
 */
export function declineMessage(group: GroupTerms, payLink: string | null): string {
  const custom = group.declineMessage?.trim();
  if (custom) return payLink ? withLink(custom, payLink) : custom;

  if (group.businessPostCents == null) {
    return [
      `Thanks for wanting to post in ${group.name}.`,
      "This group is for neighbours, so we don't allow business posts.",
      "You're very welcome to take part as a member.",
    ].join(" ");
  }

  const price = dollars(group.businessPostCents);
  const days = group.passDays;
  return [
    `Thanks for wanting to post in ${group.name}.`,
    `We keep the feed clear for neighbours, so business posts are paid: ${price} covers one post, good for ${days} day${days === 1 ? "" : "s"}.`,
    payLink ? `You can sort it here and you'll get a code to send us: ${payLink}` : "Message the page and we'll sort you out.",
  ].join(" ");
}

function withLink(message: string, payLink: string): string {
  return message.includes(payLink) ? message : `${message.trim()} ${payLink}`;
}

/**
 * The Admin Assist settings to paste into Facebook, for one group.
 *
 * This is the part that actually blocks posts, and it runs on Facebook rather
 * than here, because that is the only place it can run any more. Printed as
 * something a person copies once per group and then leaves alone.
 */
export interface AdminAssistPlan {
  /** One per line, which is the format the Facebook box wants. */
  keywords: string[];
  declineMessage: string;
  steps: string[];
}

export function adminAssistPlan(group: GroupTerms, blockWords: readonly string[], payLink: string | null): AdminAssistPlan {
  const keywords = Array.from(
    new Set([...DEFAULT_BLOCK_WORDS, ...blockWords.map((w) => w.trim()).filter(Boolean)])
  ).sort((a, b) => a.localeCompare(b));

  return {
    keywords,
    declineMessage: declineMessage(group, payLink),
    steps: [
      "Open the group on Facebook, then Admin tools, then Admin Assist.",
      'Add a criterion: "Decline posts that contain specific words or phrases".',
      "Paste the words below, one per line.",
      "Turn on the option to tell the author why, and paste the message below as the reason.",
      "Save. Facebook does the declining and shows them that message; nothing here can do it for you.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

export type PassStatus = "unpaid" | "paid" | "used" | "refunded" | "expired";

/** When a pass bought now stops being good. */
export function passExpiry(paidAt: Date, passDays: number): Date {
  const out = new Date(paidAt.getTime());
  out.setUTCDate(out.getUTCDate() + passDays);
  return out;
}

/**
 * Whether an admin should let this post through.
 *
 * Expiry is checked against the clock rather than trusted from the row: a pass
 * that lapsed last week is still marked 'paid' until something writes to it,
 * and the admin looking at a post right now needs the answer for right now.
 */
export function passIsGood(
  pass: { status: PassStatus; expiresAt: string | null },
  now: Date = new Date()
): boolean {
  if (pass.status !== "paid") return false;
  if (!pass.expiresAt) return true;
  return new Date(pass.expiresAt).getTime() > now.getTime();
}

export function passStatusLabel(pass: { status: PassStatus; expiresAt: string | null }, now: Date = new Date()): string {
  if (pass.status === "unpaid") return "Not paid";
  if (pass.status === "refunded") return "Refunded";
  if (pass.status === "used") return "Used";
  if (pass.status === "paid" && !passIsGood(pass, now)) return "Expired";
  return "Good to post";
}

// ---------------------------------------------------------------------------
// Whether a group is worth running
// ---------------------------------------------------------------------------

export interface GroupPostRow {
  groupId: string;
  kind: PostKind;
  handledAt: string | null;
}

export interface GroupTally {
  groupId: string;
  requests: number;
  promotions: number;
  other: number;
  /** Requests nobody has answered yet. The number that should be zero. */
  unanswered: number;
  /** Passes sold, in cents. */
  earnedCents: number;
}

/**
 * What each group produced.
 *
 * Requests are the reason to run one at all, so they lead. Unanswered
 * requests are separated out because a group generating leads nobody answers
 * is worse than no group: the neighbours watched somebody else get the job.
 */
export function tallyGroups(
  posts: readonly GroupPostRow[],
  passes: readonly { groupId: string; status: PassStatus; amountCents: number }[]
): Map<string, GroupTally> {
  const tallies = new Map<string, GroupTally>();
  const of = (groupId: string): GroupTally => {
    const found = tallies.get(groupId) ?? {
      groupId,
      requests: 0,
      promotions: 0,
      other: 0,
      unanswered: 0,
      earnedCents: 0,
    };
    tallies.set(groupId, found);
    return found;
  };

  for (const post of posts) {
    const tally = of(post.groupId);
    if (post.kind === "request") {
      tally.requests += 1;
      if (!post.handledAt) tally.unanswered += 1;
    } else if (post.kind === "promotion") {
      tally.promotions += 1;
    } else {
      tally.other += 1;
    }
  }

  for (const pass of passes) {
    if (pass.status !== "paid" && pass.status !== "used") continue;
    of(pass.groupId).earnedCents += pass.amountCents;
  }

  return tallies;
}

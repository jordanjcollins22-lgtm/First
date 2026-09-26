/**
 * The finder's rules, for every platform.
 *
 * Whatever a post was read from, it arrives as the same few facts: where it
 * is, who wrote it, where it was posted, what it says, when, and why it was
 * kept. This is where "why" is worked out, where a platform's own shape is
 * turned into those facts, and where a post gets the key that stops it being
 * kept twice.
 *
 * Nothing here fetches or stores. It decides.
 */

export type Platform = "facebook" | "reddit" | "nextdoor" | "instagram" | "x" | "other";

export const PLATFORM_LABEL: Record<Platform, string> = {
  facebook: "Facebook",
  reddit: "Reddit",
  nextdoor: "Nextdoor",
  instagram: "Instagram",
  x: "X",
  other: "Elsewhere",
};

export interface FoundPost {
  platform: Platform;
  /** Unique across platforms: the same post read twice is kept once. */
  key: string;
  url: string;
  author: string | null;
  /** The group, subreddit or feed it was posted in. */
  where: string | null;
  text: string;
  postedAt: Date | null;
}

export interface MatchVerdict {
  matched: boolean;
  /** The work words the post used, in the order they were listed. */
  words: string[];
  /** The first place word it named, when it named one. */
  area: string | null;
  /** Said to a person: why this post was kept. Null when it was not. */
  reason: string | null;
}

function found(text: string, words: readonly string[]): string[] {
  const body = text.toLowerCase();
  const out: string[] = [];
  for (const word of words) {
    const needle = word.trim().toLowerCase();
    if (needle && body.includes(needle) && !out.includes(needle)) out.push(needle);
  }
  return out;
}

/**
 * Whether a post matches, and why.
 *
 * It has to name the work. Where `needArea` is set -- anything read from a
 * place that is not local by construction, like a state-wide subreddit or a
 * public search -- it has to name somewhere near the business too, or it is
 * somebody in another county.
 */
export function matchReason(input: {
  text: string;
  keywords: readonly string[];
  areaWords: readonly string[];
  needArea: boolean;
}): MatchVerdict {
  const words = found(input.text, input.keywords);
  const area = found(input.text, input.areaWords)[0] ?? null;
  const matched = words.length > 0 && (!input.needArea || area !== null);
  if (!matched) return { matched, words, area, reason: null };
  const said = words.slice(0, 3).map((w) => `“${w}”`).join(", ");
  const reason = `Mentions ${said}${words.length > 3 ? ` and ${words.length - 3} more` : ""}${area ? `, in ${titleCase(area)}` : ""}`;
  return { matched, words, area, reason };
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** When a post went up, from how many days old it was when it was read. */
export function postedAtFromAge(ageDays: number | null, readAt: Date): Date | null {
  if (ageDays == null) return null;
  return new Date(readAt.getTime() - ageDays * 86_400_000);
}

/** Whole days between a post going up and now. */
export function ageInDays(postedAt: Date | null, now: Date): number | null {
  if (!postedAt) return null;
  return Math.max(0, Math.floor((now.getTime() - postedAt.getTime()) / 86_400_000));
}

/* ------------------------------------------------------------------ Reddit */

/** A subreddit name as Reddit spells it in a URL, or null when it is not one. */
export function cleanSubreddit(raw: string): string | null {
  const name = raw.trim().replace(/^\/?r\//i, "").replace(/\/+$/, "");
  return /^[A-Za-z0-9_]{2,21}$/.test(name) ? name : null;
}

/**
 * Where to ask Reddit for a subreddit's newest posts.
 *
 * The newest fifty, matched here, rather than one search per phrase: one
 * request a subreddit instead of a dozen, which is what keeps the finder
 * inside Reddit's limits when it runs every half hour.
 */
export function redditNewPath(subreddit: string): string {
  return `/r/${subreddit}/new.json?limit=50&raw_json=1`;
}

/**
 * Whether a subreddit is local by its name, so a post there need not name a
 * town: r/harfordcounty is Harford County, r/maryland is not.
 */
export function subredditIsLocal(subreddit: string, areaWords: readonly string[]): boolean {
  const name = subreddit.toLowerCase();
  return areaWords.some((word) => {
    const squashed = word.toLowerCase().replace(/[^a-z0-9]/g, "");
    return squashed.length >= 4 && name.includes(squashed);
  });
}

/**
 * The posts in a Reddit listing, as found posts.
 *
 * Read defensively: a listing that is not a listing, a post with no id or
 * no permalink, or a removed post comes back as nothing rather than as an
 * error, because one odd post must not stop the rest being read.
 */
export function parseRedditListing(json: unknown): FoundPost[] {
  const children = (json as { data?: { children?: unknown[] } } | null)?.data?.children;
  if (!Array.isArray(children)) return [];
  const out: FoundPost[] = [];
  for (const child of children) {
    const d = (child as { kind?: string; data?: Record<string, unknown> })?.data;
    if (!d || (child as { kind?: string }).kind !== "t3") continue;
    const id = typeof d.id === "string" ? d.id : null;
    const permalink = typeof d.permalink === "string" ? d.permalink : null;
    if (!id || !permalink) continue;
    if (d.removed_by_category || d.selftext === "[removed]" || d.selftext === "[deleted]") continue;
    const title = typeof d.title === "string" ? d.title : "";
    const body = typeof d.selftext === "string" ? d.selftext : "";
    const author = typeof d.author === "string" && d.author !== "[deleted]" ? `u/${d.author}` : null;
    const created = typeof d.created_utc === "number" ? new Date(d.created_utc * 1000) : null;
    out.push({
      platform: "reddit",
      key: `reddit:${id}`,
      url: `https://www.reddit.com${permalink}`,
      author,
      where: typeof d.subreddit === "string" ? `r/${d.subreddit}` : null,
      text: [title, body].filter(Boolean).join("\n\n").slice(0, 4000),
      postedAt: created,
    });
  }
  return out;
}

/* ------------------------------------------------------ links pasted in */

function parse(url: string): URL | null {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed : null;
  } catch {
    return null;
  }
}

/** Which platform a link is on, from its address. */
export function platformOfLink(url: string): Platform {
  const host = parse(url)?.hostname.toLowerCase() ?? "";
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(host)) return "facebook";
  if (/(^|\.)reddit\.com$|(^|\.)redd\.it$/.test(host)) return "reddit";
  if (/(^|\.)nextdoor\.com$/.test(host)) return "nextdoor";
  if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
  if (/(^|\.)(x\.com|twitter\.com)$/.test(host)) return "x";
  return "other";
}

/**
 * The key a pasted link is kept under, the same however it was shared.
 *
 * Tracking bits on the end ("?mibextid=", "?utm_source=") differ every time
 * a link is copied, so they are dropped: two people pasting the same post
 * from two phones get the same key, and the second is told it is in. The
 * finder's own Facebook keys (group/post) are used where the link carries
 * them, so a pasted link meets the post the extension already read.
 */
export function postKeyForLink(url: string): string | null {
  const parsed = parse(url);
  if (!parsed) return null;
  const platform = platformOfLink(url);
  const path = parsed.pathname.replace(/\/+$/, "");
  if (platform === "facebook") {
    const groupPost = path.match(/\/groups\/([^/]+)\/(?:posts|permalink)\/([^/?#]+)/);
    if (groupPost) return `${groupPost[1]}/${groupPost[2]}`;
    const story = parsed.searchParams.get("story_fbid");
    const owner = parsed.searchParams.get("id");
    if (story && owner) return `${owner}/${story}`;
    const share = path.match(/\/share\/(?:[a-z]\/)?([A-Za-z0-9]+)/);
    if (share) return `fb-share:${share[1]}`;
    const page = path.match(/^\/([^/]+)\/posts\/([^/?#]+)/);
    if (page) return `${page[1]}/${page[2]}`;
  }
  if (platform === "reddit") {
    const id = path.match(/\/comments\/([a-z0-9]+)/i) ?? (/(^|\.)redd\.it$/.test(parsed.hostname) ? path.match(/^\/([a-z0-9]+)/i) : null);
    if (id) return `reddit:${id[1].toLowerCase()}`;
  }
  if (platform === "nextdoor") {
    const id = path.match(/\/p\/([A-Za-z0-9_-]+)/);
    if (id) return `nextdoor:${id[1]}`;
  }
  if (platform === "instagram") {
    const id = path.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
    if (id) return `instagram:${id[1]}`;
  }
  if (platform === "x") {
    const id = path.match(/\/status\/(\d+)/);
    if (id) return `x:${id[1]}`;
  }
  return `${platform}:${parsed.hostname.replace(/^www\./, "")}${path}`.toLowerCase().slice(0, 300);
}

/** The link as it will be opened, with the tracking bits taken off. */
export function cleanLink(url: string): string | null {
  const parsed = parse(url);
  if (!parsed) return null;
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|mibextid|fbclid|rdid|share_url|s$|ref$|sfnsn|igsh)/i.test(key)) parsed.searchParams.delete(key);
  }
  parsed.hash = "";
  return parsed.toString();
}

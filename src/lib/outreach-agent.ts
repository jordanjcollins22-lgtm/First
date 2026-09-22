/**
 * The group agent: what it may do, and the decisions it makes without a model.
 *
 * The browser looks through the groups on a timer and sends what it finds.
 * Before anything is read by a model or written under a stranger's post,
 * three cheap questions are answered here: is this the same post as one
 * already seen, does it so much as mention the work, and is the agent
 * allowed to post right now. A model call costs seconds and a comment costs
 * the account's standing in the group, so both are spent only after these.
 *
 * Nothing here calls anything. Pure functions over the settings and the
 * counts, so the rules can be tested without a browser or a database.
 */

export interface AgentGroup {
  url: string;
  name: string;
}

export interface AgentSettings {
  groups: AgentGroup[];
  keywords: string[];
  dailyCap: number;
  hourlyCap: number;
  /** "08:00", local to the business. */
  activeFrom: string;
  activeTo: string;
  scanEveryMinutes: number;
  maxAgeDays: number;
  autoPost: boolean;
  pausedUntil: string | null;
  pauseReason: string | null;
}

export const DEFAULT_KEYWORDS = [
  "lawn", "mow", "landscap", "mulch", "leaf", "leaves", "clean up", "cleanup", "yard",
  "hedge", "shrub", "bush", "grass", "weed", "aerat", "seed", "sod", "trim", "edging",
  "snow", "plow", "salt", "gutter", "brush", "overgrown", "flower bed", "garden",
];

export const DEFAULT_SETTINGS: AgentSettings = {
  groups: [],
  keywords: DEFAULT_KEYWORDS,
  dailyCap: 6,
  hourlyCap: 2,
  activeFrom: "08:00",
  activeTo: "20:00",
  scanEveryMinutes: 30,
  maxAgeDays: 5,
  autoPost: true,
  pausedUntil: null,
  pauseReason: null,
};

/**
 * One name for one post, whatever URL it arrived under.
 *
 * Facebook hands out the same post as /groups/G/posts/P, /groups/G/permalink/P,
 * and permalink.php?story_fbid=P&id=G, each with a different tail of tracking
 * parameters. The group and post ids are the post; everything else is noise.
 * Anything unrecognised keys on its path alone, so at least the tracking tail
 * does not make it a new post every time.
 */
export function postKeyFrom(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  const groupPost = path.match(/\/groups\/([^/]+)\/(?:posts|permalink)\/(\d+)/);
  if (groupPost) return `${groupPost[1]}/${groupPost[2]}`;
  const story = parsed.searchParams.get("story_fbid");
  const owner = parsed.searchParams.get("id");
  if (story && owner) return `${owner}/${story}`;
  const multiPermalink = parsed.searchParams.get("multi_permalinks");
  const groupOnly = path.match(/\/groups\/([^/]+)/);
  if (multiPermalink && groupOnly) return `${groupOnly[1]}/${multiPermalink.split(",")[0]}`;
  const anyPost = path.match(/\/(?:posts|permalink|videos|photos)\/(\d+)/);
  if (anyPost) return `${path.split("/")[1] ?? "p"}/${anyPost[1]}`;
  if (!path || path === "/") return null;
  return `${parsed.hostname}${path}`.toLowerCase();
}

/** The link as it should be opened: no tracking tail, and no fragment. */
export function cleanPostUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const keep = new URLSearchParams();
    for (const key of ["story_fbid", "id", "multi_permalinks"]) {
      const value = parsed.searchParams.get(key);
      if (value) keep.set(key, value);
    }
    const query = keep.toString();
    return `${parsed.origin}${parsed.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return url;
  }
}

/** Whether the words so much as mention the work. Case does not matter. */
export function matchesKeywords(text: string, keywords: readonly string[]): boolean {
  const body = (text ?? "").toLowerCase();
  if (!body.trim()) return false;
  return keywords.some((word) => {
    const needle = word.trim().toLowerCase();
    return needle.length > 0 && body.includes(needle);
  });
}

/**
 * How old a post is, from the short label Facebook prints on it.
 *
 * "3h", "45m" and "Just now" are today. "2d" is two days. "1w" is seven.
 * "Yesterday" is one. A date like "September 14" is counted back from now;
 * anything else is unknown, and unknown is left to the reader of the post.
 */
export function ageDaysFromLabel(label: string | null | undefined, now: Date = new Date()): number | null {
  const text = (label ?? "").trim().toLowerCase();
  if (!text) return null;
  if (/^(just now|now|\d+\s*(s|m|min|mins|h|hr|hrs|hour|hours|minute|minutes|second|seconds))\b/.test(text)) return 0;
  const days = text.match(/^(\d+)\s*(d|day|days)\b/);
  if (days) return Number(days[1]);
  const weeks = text.match(/^(\d+)\s*(w|wk|week|weeks)\b/);
  if (weeks) return Number(weeks[1]) * 7;
  if (/^yesterday/.test(text)) return 1;
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const dated = text.match(/^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?/);
  if (dated) {
    const month = months.findIndex((m) => m.startsWith(dated[1].slice(0, 3)));
    if (month >= 0) {
      const year = dated[3] ? Number(dated[3]) : now.getFullYear();
      let when = new Date(year, month, Number(dated[2]));
      if (!dated[3] && when.getTime() > now.getTime() + 86_400_000) when = new Date(year - 1, month, Number(dated[2]));
      return Math.max(0, Math.floor((now.getTime() - when.getTime()) / 86_400_000));
    }
  }
  return null;
}

/** "HH:MM" in the given zone, for comparing against the active hours. */
export function localClock(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(now);
    const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    return `${hour === "24" ? "00" : hour}:${minute}`;
  } catch {
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }
}

/** Whether the clock is inside the window. A window that wraps midnight works too. */
export function withinActiveHours(clock: string, from: string, to: string): boolean {
  const minutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  const now = minutes(clock);
  const start = minutes(from);
  const end = minutes(to);
  if (start === end) return true;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}

export type Standing =
  | { active: true }
  | { active: false; because: "paused" | "outside hours" | "no groups" | "capped for the day" | "capped for the hour" };

/**
 * Whether the agent may post right now, and if not, why.
 *
 * The answer is worked out here rather than in the browser so the browser
 * only has one question to ask. The reasons are words a person reads in the
 * popup, so they are written as such.
 */
export function standing(input: {
  settings: AgentSettings;
  now: Date;
  timeZone: string;
  postedToday: number;
  postedThisHour: number;
}): Standing {
  const { settings } = input;
  if (settings.pausedUntil && new Date(settings.pausedUntil).getTime() > input.now.getTime()) {
    return { active: false, because: "paused" };
  }
  if (settings.groups.length === 0) return { active: false, because: "no groups" };
  if (!withinActiveHours(localClock(input.now, input.timeZone), settings.activeFrom, settings.activeTo)) {
    return { active: false, because: "outside hours" };
  }
  if (input.postedToday >= settings.dailyCap) return { active: false, because: "capped for the day" };
  if (input.postedThisHour >= settings.hourlyCap) return { active: false, because: "capped for the hour" };
  return { active: true };
}

/** How many more comments may be queued now, counting the ones already waiting. */
export function allowance(input: {
  settings: AgentSettings;
  postedToday: number;
  postedThisHour: number;
  queued: number;
}): number {
  const day = input.settings.dailyCap - input.postedToday - input.queued;
  const hour = input.settings.hourlyCap - input.postedThisHour - input.queued;
  return Math.max(0, Math.min(day, hour));
}

export type Decision = "queued" | "ready" | "posted" | "failed" | "not_request" | "too_old" | "capped" | "draft_failed" | "skipped";

export const DECISION_LABEL: Record<Decision, string> = {
  queued: "Waiting to post",
  ready: "Written, on the board to paste",
  posted: "Posted",
  failed: "Couldn't post",
  not_request: "Not asking for work",
  too_old: "Too old",
  capped: "Over the cap, not answered",
  draft_failed: "Couldn't write one",
  skipped: "Skipped",
};

/**
 * Whether the reading of a post says it is worth answering.
 *
 * A request, for one of the things we actually do, that is not stale. The
 * reader marks adverts and chatter; the age cut-off is here, because "who
 * mows lawns?" from a week ago has been answered by somebody else and a
 * comment under it now reads as trawling.
 */
export function worthAnswering(input: {
  kind: string;
  service: string | null;
  ageDays: number | null;
  maxAgeDays: number;
}): { yes: true } | { yes: false; decision: Decision; reason: string } {
  if (input.kind !== "request") return { yes: false, decision: "not_request", reason: "Not a request for work." };
  if (!input.service) return { yes: false, decision: "not_request", reason: "Not for a service we sell." };
  if (input.ageDays != null && input.ageDays > input.maxAgeDays) {
    return { yes: false, decision: "too_old", reason: `Posted ${input.ageDays} days ago.` };
  }
  return { yes: true };
}

/** Seconds to wait before the next comment. Never a round number, never quick. */
export function nextDelaySeconds(random: () => number = Math.random): number {
  return 90 + Math.floor(random() * 210);
}

/**
 * Whether Facebook has told the account to stop.
 *
 * Matched on the words in the dialog rather than anything structural,
 * because the words are the part that has stayed the same for years. Any
 * of these pauses the agent for a day: a second attempt straight after a
 * block is what turns a day's block into a month's.
 */
export function looksLikeBlock(text: string): boolean {
  const body = (text ?? "").toLowerCase();
  return (
    /temporarily (blocked|restricted)/.test(body) ||
    /action blocked/.test(body) ||
    /you can'?t use this feature/.test(body) ||
    /you.re (temporarily )?blocked/.test(body) ||
    /we limit how often/.test(body) ||
    /going too fast/.test(body) ||
    /restricted from (posting|commenting)/.test(body)
  );
}

/** The settings as the browser gets them, with the keys it reads. */
export function settingsForBrowser(settings: AgentSettings): Omit<AgentSettings, "pausedUntil" | "pauseReason"> {
  return {
    groups: settings.groups,
    keywords: settings.keywords,
    dailyCap: settings.dailyCap,
    hourlyCap: settings.hourlyCap,
    activeFrom: settings.activeFrom,
    activeTo: settings.activeTo,
    scanEveryMinutes: settings.scanEveryMinutes,
    maxAgeDays: settings.maxAgeDays,
    autoPost: settings.autoPost,
  };
}

/** A group URL, checked and trimmed to the group itself. */
export function normaliseGroupUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)facebook\.com$/.test(parsed.hostname)) return null;
  const match = parsed.pathname.match(/^\/groups\/([^/?#]+)/);
  if (!match) return null;
  return `https://www.facebook.com/groups/${match[1]}/`;
}

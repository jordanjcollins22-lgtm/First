/**
 * The rules of the Posts to answer board.
 *
 * The browser finds the posts; the team answers them, each from their own
 * account. Two comments from us under one neighbour's post reads as two
 * people who can vouch for the business; a third starts to look like a
 * campaign. So a post takes two answers. A place is held by whoever took
 * it: for good once they say it is posted, and for a couple of hours while
 * they are writing it. After that the place is free again, because somebody
 * who took a post and went to lunch should not leave the neighbour waiting.
 *
 * The owner is never turned away. It is their business and their call,
 * so they can take a post however many have answered it, and however many
 * they have answered today.
 *
 * Pure functions, so the rules are tested without a database.
 */

/** How many of the team may answer one post. The owner can always add one more. */
export const ANSWERS_PER_POST = 2;

/** How long taking a post holds it before somebody else may. */
export const HOLD_HOURS = 2;

/** Older than this and the neighbour has found somebody: off the board. */
export const BOARD_MAX_AGE_DAYS = 14;

/**
 * How many one person may answer in a day, from their own account. Kept
 * low on purpose: the point of spreading the answering across the team is
 * that no one account looks like it does nothing else.
 */
export const DEFAULT_DAILY_PER_PERSON = 6;

export type AnswerStatus = "written" | "posted" | "let_go";

export interface BoardAnswer {
  id: string;
  profileId: string;
  name: string;
  status: AnswerStatus;
  comment: string | null;
  code: string | null;
  clicks: number;
  createdAt: string;
  updatedAt: string;
  postedAt: string | null;
}

/**
 * Where a post stands for the person looking at it.
 *
 * mine: they took it. open: there is still a place on it. full: both
 * places are taken by others.
 */
export type BoardPile = "open" | "mine" | "full";

export interface BoardStanding {
  pile: BoardPile;
  /** This person's own answer, when they took it. */
  mine: BoardAnswer | null;
  /** Everybody else holding a place on it: posted, or writing right now. */
  others: BoardAnswer[];
}

function holds(answer: BoardAnswer, now: Date): boolean {
  if (answer.status === "posted") return true;
  if (answer.status !== "written") return false;
  return now.getTime() - new Date(answer.updatedAt).getTime() < HOLD_HOURS * 3_600_000;
}

/**
 * Which pile a post is in for one person.
 *
 * Mine first: a post somebody took stays in front of them however many
 * others answered it since. Otherwise it is open while fewer than two of
 * the others hold it, and full once two do.
 */
export function standingFor(answers: BoardAnswer[], profileId: string, now: Date): BoardStanding {
  const mine = answers.find((a) => a.profileId === profileId && a.status !== "let_go") ?? null;
  const others = answers
    .filter((a) => a.profileId !== profileId && holds(a, now))
    // Posted before writing, then earliest first, so the names read in order.
    .sort((a, b) => (a.status === b.status ? a.createdAt.localeCompare(b.createdAt) : a.status === "posted" ? -1 : 1));
  if (mine) return { pile: "mine", mine, others };
  return { pile: others.length >= ANSWERS_PER_POST ? "full" : "open", mine: null, others };
}

/** "Jace and Andrew", for saying who has a post. */
export function namesOf(answers: BoardAnswer[]): string {
  const names = answers.map((a) => a.name);
  if (names.length <= 1) return names[0] ?? "Somebody";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Why this person may not take this post, or null when they may.
 *
 * `override` is the owner: never turned away, by a full post or by the
 * day's limit.
 */
export function whyNotTake(input: {
  answers: BoardAnswer[];
  profileId: string;
  now: Date;
  answeredToday: number;
  dailyLimit: number;
  override?: boolean;
}): string | null {
  const standing = standingFor(input.answers, input.profileId, input.now);
  if (standing.pile === "mine" || input.override) return null;
  if (standing.pile === "full") {
    return `${namesOf(standing.others)} already have this one. Two answers a post is the most, so leave it to them.`;
  }
  if (input.answeredToday >= input.dailyLimit) {
    return `That's ${input.answeredToday} from your account today. More than that in a day and Facebook starts to notice, so leave the rest for tomorrow or for somebody else.`;
  }
  return null;
}

/**
 * How old the post is now, in days.
 *
 * The age was read off the post when it was found; the days since then are
 * added, so a post found "2d" ago last week is not still two days old.
 */
export function ageNow(ageDaysWhenRead: number | null, readAt: string, now: Date): number {
  const since = Math.max(0, Math.floor((now.getTime() - new Date(readAt).getTime()) / 86_400_000));
  return (ageDaysWhenRead ?? 0) + since;
}

/** Whether the post is still worth answering at all. */
export function stillFresh(ageDaysWhenRead: number | null, readAt: string, now: Date): boolean {
  return ageNow(ageDaysWhenRead, readAt, now) <= BOARD_MAX_AGE_DAYS;
}

/**
 * Whether a link opens the post itself.
 *
 * A post the page showed without a link used to go on the board with a
 * Facebook search for its words instead, and the search almost never found
 * it: the person pressing "Open the post" landed on a page of other people's
 * posts. Only a link to the post counts -- a group post, a permalink, a page
 * post, or the short link Facebook's Share menu copies. A group's front page
 * or somebody's profile is not the post.
 */
export function isPostLink(url: string | null | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  // A Reddit post: /r/<sub>/comments/<id>/...
  if (/(^|\.)reddit\.com$/i.test(parsed.hostname)) return /^\/r\/[A-Za-z0-9_]+\/comments\/[a-z0-9]+/i.test(parsed.pathname);
  if (/(^|\.)nextdoor\.com$/i.test(parsed.hostname)) return /^\/p\/[A-Za-z0-9_-]+/.test(parsed.pathname);
  if (/(^|\.)instagram\.com$/i.test(parsed.hostname)) return /^\/(p|reel)\/[A-Za-z0-9_-]+/.test(parsed.pathname);
  if (/(^|\.)(x|twitter)\.com$/i.test(parsed.hostname)) return /\/status\/\d+/.test(parsed.pathname);
  if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) return false;
  const path = parsed.pathname;
  return (
    /\/groups\/[^/]+\/(posts|permalink)\/\d+/i.test(path) ||
    /\/share\/(p|r|v)?\/?[A-Za-z0-9]+/i.test(path) ||
    /\/[^/]+\/posts\/[A-Za-z0-9]+/i.test(path) ||
    (/\/permalink\.php$|\/story\.php$/i.test(path) && parsed.searchParams.has("story_fbid"))
  );
}

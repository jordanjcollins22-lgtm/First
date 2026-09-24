/**
 * The rules of the Posts to answer board.
 *
 * The browser finds the posts; the team answers them, each from their own
 * account. Two people answering the same neighbour looks like exactly the
 * thing it is, so a post is held by whoever took it: for good once they say
 * it is posted, and for a couple of hours while they are writing it. After
 * that it is open again, because somebody who took a post and went to lunch
 * should not leave the neighbour unanswered.
 *
 * Pure functions, so the rules are tested without a database.
 */

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

/** Where a post stands for the person looking at it. */
export type BoardPile = "open" | "mine" | "taken" | "answered";

export interface BoardStanding {
  pile: BoardPile;
  /** This person's own answer, when they took it. */
  mine: BoardAnswer | null;
  /** Whoever else holds it or answered it, when somebody does. */
  heldBy: BoardAnswer | null;
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
 * others answered it since. Then answered, when anybody else's comment is
 * up. Then taken, while somebody else is writing theirs. Otherwise open.
 */
export function standingFor(answers: BoardAnswer[], profileId: string, now: Date): BoardStanding {
  const mine = answers.find((a) => a.profileId === profileId && a.status !== "let_go") ?? null;
  const others = answers.filter((a) => a.profileId !== profileId);
  const posted = others.find((a) => a.status === "posted") ?? null;
  const writing = others.find((a) => holds(a, now)) ?? null;
  if (mine) return { pile: "mine", mine, heldBy: posted ?? writing };
  if (posted) return { pile: "answered", mine: null, heldBy: posted };
  if (writing) return { pile: "taken", mine: null, heldBy: writing };
  return { pile: "open", mine: null, heldBy: null };
}

/** Why this person may not take this post, or null when they may. */
export function whyNotTake(input: {
  answers: BoardAnswer[];
  profileId: string;
  now: Date;
  answeredToday: number;
  dailyLimit: number;
}): string | null {
  const standing = standingFor(input.answers, input.profileId, input.now);
  if (standing.pile === "mine") return null;
  if (standing.pile === "answered") return `${standing.heldBy?.name ?? "Somebody"} already answered this one.`;
  if (standing.pile === "taken") return `${standing.heldBy?.name ?? "Somebody"} is answering this one right now.`;
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

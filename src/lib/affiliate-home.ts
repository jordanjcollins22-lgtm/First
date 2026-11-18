import type { BoardPost } from "@/lib/data/post-board";
import type { BroughtInRow } from "@/lib/brought-in";
import type { CommissionSummary } from "@/lib/commission";
import type { ReferralProgress, ReferralRow } from "@/lib/data/referrals";

/**
 * The affiliate's home screen, the pure parts: what of the post board is
 * theirs to see, and their own results and money in three numbers each.
 */

/**
 * The board as an affiliate may see it. Somebody else on a post shows as a
 * first name and whether they answered it ("Room for yours"), never their
 * comment, their tracked code or their clicks: those are that person's own.
 */
export function privateBoard(posts: BoardPost[]): BoardPost[] {
  return posts.map((post) => ({
    ...post,
    others: post.others.map((a, i) => ({
      ...a,
      id: `${post.id}:other:${i}`,
      profileId: "",
      comment: null,
      code: null,
      clicks: 0,
    })),
  }));
}

export interface AffiliateResults {
  /** Every open of every link they put out. */
  clicks: number;
  /** Projects booked through them: a tracked link or their booking link. */
  booked: number;
  /** Of those, sold or done. */
  sold: number;
}

export function affiliateResults(clickCounts: (number | null | undefined)[], projects: BroughtInRow[]): AffiliateResults {
  return {
    clicks: clickCounts.reduce<number>((sum, c) => sum + (Number(c) || 0), 0),
    booked: projects.length,
    sold: projects.filter((p) => p.step === "sold" || p.step === "done").length,
  };
}

export interface AffiliateMoney {
  /** Everything their share has come to so far, paid or not. */
  earned: number;
  /** Already handed over. */
  paid: number;
  /** Earned and not handed over yet. */
  owed: number;
}

export function affiliateMoney(summary: CommissionSummary | null): AffiliateMoney {
  if (!summary) return { earned: 0, paid: 0, owed: 0 };
  const owed = round2(summary.earned + summary.held + summary.accruing);
  const paid = round2(summary.paid);
  return { earned: round2(owed + paid), paid, owed };
}

/**
 * How far each person they sent their link to got: sent, opened, booked or
 * sold, with their 4% once there's a price. Matched on the tracked link's code.
 */
export function withProgress(rows: ReferralRow[], projects: BroughtInRow[]): ReferralRow[] {
  const byCode = new Map<string, BroughtInRow>();
  for (const p of projects) if (p.referralCode && !byCode.has(p.referralCode)) byCode.set(p.referralCode, p);
  return rows.map((r) => {
    const job = r.code ? byCode.get(r.code) : undefined;
    let progress: ReferralProgress = r.clicks > 0 ? "opened" : "sent";
    if (job) progress = job.step === "lost" ? "lost" : job.step === "sold" || job.step === "done" ? "sold" : "booked";
    return { ...r, progress, yours: job && progress === "sold" ? job.yours : null };
  });
}

export interface AffiliateStage {
  /** Stages done, in order: a stage counts only once every one before it is done. */
  done: number;
  /** All of them, the optional move-up last. */
  total: number;
  /** What the next one asks, as written in the job's growth track; null once the track is finished. */
  next: string | null;
  /** The next one is something the app can't see; the account manager marks it. */
  nextNeedsAManager: boolean;
}

/**
 * Where they are on the affiliate's Stages of Success, from what the app can
 * see: their link, referred jobs, their 4% paid, and booked work. A client's
 * review the app can't see, so that stage waits on the account manager.
 */
export function affiliateStage(input: {
  stages: readonly string[];
  hasLink: boolean;
  projects: BroughtInRow[];
  paid: number;
  /** Stages the account manager has marked done, by number from 1. */
  marked?: readonly number[];
  now?: Date;
}): AffiliateStage {
  const live = input.projects.filter((p) => p.step !== "lost");
  const won = live.filter((p) => p.step === "sold" || p.step === "done");
  const months = new Set(live.map((p) => p.createdAt.slice(0, 7)));
  const now = input.now ?? new Date();
  const monthKey = (back: number) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    return d.toISOString().slice(0, 7);
  };
  // Three months in a row, ending this month or last (this month may not be over).
  const threeInARow = [0, 1].some((end) => [0, 1, 2].every((i) => months.has(monthKey(end + i))));
  const bookedWork = won.reduce((sum, p) => sum + (p.price ?? 0), 0);
  const checks: (boolean | null)[] = [
    input.hasLink,
    live.some((p) => p.step === "done") && input.paid > 0,
    live.length >= 5,
    null, // a review from a client they sent: marked by the account manager
    threeInARow,
    bookedWork >= 10000,
  ];
  const marked = new Set(input.marked ?? []);
  let done = 0;
  for (let i = 0; i < Math.min(checks.length, input.stages.length); i++) {
    if (checks[i] === true || marked.has(i + 1)) done++;
    else break;
  }
  const total = input.stages.length + 1;
  return { done, total, next: done < input.stages.length ? input.stages[done] : null, nextNeedsAManager: checks[done] === null };
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

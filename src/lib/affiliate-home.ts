import type { BoardPost } from "@/lib/data/post-board";
import type { BroughtInRow } from "@/lib/brought-in";
import type { CommissionSummary } from "@/lib/commission";

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

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

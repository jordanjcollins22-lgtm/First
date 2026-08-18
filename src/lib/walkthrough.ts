/**
 * The account manager's walk of the job before the crew packs up.
 *
 * Sign-off was the crew's own call, so the first person to find a problem was
 * the client. A snag caught while the tools are still out costs ten minutes;
 * the same snag found next week costs a trip, an apology, and the client's
 * confidence. This puts somebody who did not do the work on the site before
 * the van doors close.
 *
 * Pure rules, so the UI can grey out a button using exactly the reasoning the
 * server applies.
 */

import type { JobWalkthrough, WalkthroughStatus } from "@/types/domain";

export const WALKTHROUGH_STATUS_LABELS: Record<WalkthroughStatus, string> = {
  requested: "Waiting on the manager",
  approved: "Approved",
  rejected: "Changes needed",
  cancelled: "Withdrawn",
};

export type Verdict = { ok: true } | { ok: false; reason: string };

const OK: Verdict = { ok: true };

export type WalkthroughShape = Pick<
  JobWalkthrough,
  "status" | "requested_at" | "reviewed_at" | "review_notes"
>;

/**
 * The one that counts.
 *
 * Rows are ordered newest first, and only the newest matters: a job rejected,
 * fixed, and passed is approved. Cancelled requests are skipped entirely —
 * withdrawing a request should leave the job exactly where it was.
 */
export function currentWalkthrough<T extends WalkthroughShape>(walkthroughs: T[]): T | null {
  return walkthroughs.find((w) => w.status !== "cancelled") ?? null;
}

export function isApproved(walkthroughs: WalkthroughShape[]): boolean {
  return currentWalkthrough(walkthroughs)?.status === "approved";
}

export function isAwaitingReview(walkthroughs: WalkthroughShape[]): boolean {
  return currentWalkthrough(walkthroughs)?.status === "requested";
}

/**
 * Whether the crew can ask for the walk.
 *
 * Refused while one is already pending, so a crew waiting on a manager cannot
 * stack five identical requests and bury the real one.
 */
export function canRequestWalkthrough(
  workStarted: boolean,
  walkthroughs: WalkthroughShape[]
): Verdict {
  if (!workStarted) {
    return { ok: false, reason: "Start a visit first — there's nothing to walk yet." };
  }
  const current = currentWalkthrough(walkthroughs);
  if (current?.status === "requested") {
    return { ok: false, reason: "Already asked — the manager hasn't been out yet." };
  }
  if (current?.status === "approved") {
    return { ok: false, reason: "Already approved. Sign the job off." };
  }
  return OK;
}

/** Whether a manager can rule on it. */
export function canReviewWalkthrough(walkthroughs: WalkthroughShape[]): Verdict {
  const current = currentWalkthrough(walkthroughs);
  if (!current) return { ok: false, reason: "Nobody has asked for a walkthrough yet." };
  if (current.status !== "requested") {
    return { ok: false, reason: "This walkthrough has already been decided." };
  }
  return OK;
}

/**
 * Whether the manager's approval is in place for sign-off.
 *
 * Kept separate from the photo rules so the two reasons never get confused —
 * "the manager hasn't been out" and "the back patio has no after photo" are
 * different problems with different people to chase.
 */
export function walkthroughGate(walkthroughs: WalkthroughShape[]): Verdict {
  const current = currentWalkthrough(walkthroughs);
  if (!current) {
    return { ok: false, reason: "Get the account manager out to approve the work first." };
  }
  switch (current.status) {
    case "approved":
      return OK;
    case "requested":
      return { ok: false, reason: "Waiting on the account manager to walk the job." };
    case "rejected":
      return {
        ok: false,
        reason: current.review_notes
          ? `Changes needed: ${current.review_notes}`
          : "The manager asked for changes. Fix them and request the walk again.",
      };
    default:
      return { ok: false, reason: "Get the account manager out to approve the work first." };
  }
}

/** How long somebody has been standing there waiting, in minutes. Drives the
 * nudge — a crew held up on site is a cost, not a queue item. */
export function minutesWaiting(walkthrough: WalkthroughShape, now: Date = new Date()): number {
  return Math.max(0, Math.round((now.getTime() - new Date(walkthrough.requested_at).getTime()) / 60_000));
}

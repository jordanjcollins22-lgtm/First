/**
 * Approving marketing plays, and learning from the changes.
 *
 * A play the app makes is a proposal. A person approves it, or changes
 * it first: takes doors out, sets how many. Every decision is kept with
 * what changed, and from those the app learns two things about door
 * hangers -- how many the business actually wants, and how far from the
 * house a hanger is worth carrying -- and makes the next plays that way.
 * After ten plays of a kind approved in a row without a change it
 * approves that kind on its own; one change and it asks again.
 *
 * Pure: the decisions in, what to make and whether to ask out.
 */

import type { MarketingPlay, PlayKind } from "@/lib/marketing-plays";

export type PlayApproval = "pending" | "approved" | "auto";
export type PlayDecision = "approve" | "auto" | "edit";

export interface PlayReview {
  playId: string | null;
  kind: PlayKind;
  reason: string | null;
  decision: PlayDecision;
  quantityBefore: number | null;
  quantityAfter: number | null;
  removedCount: number;
  keptMaxM: number | null;
  removedMinM: number | null;
  /** ISO. Newest first as listed. */
  at: string;
}

export interface LearnedDefault {
  kind: PlayKind;
  quantity: number | null;
  maxDistanceM: number | null;
}

/** The recipe before anyone has taught the app otherwise. */
export const RECIPE_QUANTITY: Record<PlayKind, number> = { yard_sign: 1, knocks: 5, door_hangers: 100, flyers: 1000 };

/** Approvals of a kind in a row, untouched, before the app approves that kind itself. */
export const ASK_UNTIL = 10;
/** Decisions looked at when learning a count or a reach. */
const LEARN_FROM = 10;

/** A person's approvals of this kind in a row since the last change. The app's own do not count. */
export function playStreak(reviews: PlayReview[], kind: PlayKind): number {
  let n = 0;
  for (const r of reviews) {
    if (r.kind !== kind) continue;
    if (r.decision === "edit") break;
    if (r.decision === "approve") n++;
  }
  return n;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * The count the business wants for a kind: the middle of the last ten
 * counts a person approved, once there are three to go on. Until then,
 * the recipe.
 */
export function learnedQuantity(reviews: PlayReview[], kind: PlayKind): number {
  const approved = reviews.filter((r) => r.kind === kind && r.decision === "approve" && r.quantityAfter != null).slice(0, LEARN_FROM);
  if (approved.length < 3) return RECIPE_QUANTITY[kind];
  return median(approved.map((r) => r.quantityAfter as number)) ?? RECIPE_QUANTITY[kind];
}

/**
 * How far from the house a hanger is worth carrying, when the business
 * has shown it: three of the last ten edits took out doors that were all
 * farther than every door kept. The reach is the farthest door kept in
 * those, plus a tenth.
 */
export function learnedReach(reviews: PlayReview[], kind: PlayKind = "door_hangers"): number | null {
  const edits = reviews.filter((r) => r.kind === kind && r.decision === "edit" && r.removedCount > 0).slice(0, LEARN_FROM);
  const trimmedFar = edits.filter((r) => r.keptMaxM != null && r.removedMinM != null && r.removedMinM >= r.keptMaxM);
  if (trimmedFar.length < 3) return null;
  const reach = Math.max(...trimmedFar.map((r) => r.keptMaxM as number));
  return Math.round(reach * 1.1);
}

export function learnedDefaults(reviews: PlayReview[]): LearnedDefault[] {
  return (["door_hangers", "flyers", "knocks"] as PlayKind[]).map((kind) => ({
    kind,
    quantity: learnedQuantity(reviews, kind),
    maxDistanceM: kind === "door_hangers" ? learnedReach(reviews) : null,
  }));
}

export interface PlayPolicy {
  decision: "ask" | "auto";
  why: string;
}

/**
 * Whether to ask a person about a play or approve it as the app: only
 * once ten of its kind went through untouched, and only when it is what
 * the business has taught the app to make (the learned count, within a
 * tenth).
 */
export function playPolicy(play: MarketingPlay, reviews: PlayReview[]): PlayPolicy {
  const streak = playStreak(reviews, play.kind);
  if (streak < ASK_UNTIL) return { decision: "ask", why: `${streak} of ${ASK_UNTIL} ${play.kind.replace("_", " ")} plays approved untouched so far` };
  const want = learnedQuantity(reviews, play.kind);
  if (play.kind !== "yard_sign" && Math.abs(play.quantity - want) > Math.max(1, want * 0.1)) {
    return { decision: "ask", why: `${play.quantity} where ${want} is usual` };
  }
  return { decision: "auto", why: `like the ${play.kind.replace("_", " ")} plays already approved` };
}

/** What the panel says about how much it still asks, per kind. */
export function describePlayTrust(reviews: PlayReview[]): string {
  const parts = (["door_hangers", "knocks", "flyers"] as PlayKind[]).map((kind) => {
    const streak = playStreak(reviews, kind);
    const label = kind.replace("_", " ");
    if (streak >= ASK_UNTIL) return `${label}: approved on their own now (${streak} in a row)`;
    return `${label}: ${streak} of ${ASK_UNTIL} approved untouched`;
  });
  const q = learnedQuantity(reviews, "door_hangers");
  const reach = learnedReach(reviews);
  const learned = [q !== RECIPE_QUANTITY.door_hangers ? `${q} hangers a play` : null, reach ? `hangers within ${reach} m of the house` : null].filter(Boolean);
  return `${parts.join(" · ")}.${learned.length ? ` Learned: ${learned.join(", ")}.` : ""}`;
}

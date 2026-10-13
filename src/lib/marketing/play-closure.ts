/**
 * When a marketing play stops being open on its own.
 *
 * Forty-odd plays sat open with none ever closed, because closing one was a
 * tick somebody had to remember. Three things now close a play without that
 * tick, in order of how sure they are:
 *
 * 1. The walk. The walker's phone left a trail, and that trail passed close
 *    enough to most of the round's doors. A trail that went past four doors
 *    out of a hundred is a walk to the car, not the round.
 * 2. The crew's "finished" tap at the job the play was made for, for the
 *    plays the crew does on their way out (the sign, the knocks, the hangers
 *    round the house). Never flyers: those go by mail.
 * 3. Whoever it was given taps done (handled where they tap; not here).
 *
 * And one thing ends a play the honest way: thirty days with nothing
 * happening, it expires with a note rather than sitting open for ever and
 * making the list a lie.
 *
 * Pure: the play, its doors, its trail and the crew's taps in; what to do out.
 */

import { metresBetween } from "@/lib/navigation";

export type ClosableKind = "yard_sign" | "knocks" | "door_hangers" | "flyers";

export interface ClosablePlay {
  id: string;
  kind: ClosableKind;
  status: "open" | "done" | "skipped";
  /** pending | approve | approved | auto */
  approval: string | null | undefined;
  createdAt: string;
  approvedAt: string | null;
  assignedAt: string | null;
  quantity: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface TrailPoint extends LatLng {
  at: string;
}

/** How close a phone has to come to a door to count as having been to it. */
export const DOOR_REACH_M = 40;

/** The share of a round's doors the trail passed within reach of. 0 with no doors. */
export function trailCoverage(doors: readonly LatLng[], trail: readonly LatLng[], reachM = DOOR_REACH_M): number {
  if (doors.length === 0 || trail.length === 0) return 0;
  let covered = 0;
  for (const door of doors) {
    for (const point of trail) {
      if (metresBetween(door, point) <= reachM) {
        covered++;
        break;
      }
    }
  }
  return covered / doors.length;
}

function isApproved(approval: string | null | undefined): boolean {
  return approval === "approve" || approval === "approved" || approval === "auto";
}

export type ClosureDecision =
  | { action: "close"; reason: "gps"; coverage: number; note: string }
  | { action: "close"; reason: "crew_finished"; note: string }
  | { action: "expire"; note: string }
  | { action: "none"; why: string };

export interface ClosureInput {
  play: ClosablePlay;
  /** The round's doors, for the walk. Empty for flyers. */
  doors: readonly LatLng[];
  trail: readonly TrailPoint[];
  /** When the crew tapped "finished" at the play's own job, latest first, if ever. */
  crewFinishedAt: string | null;
  now: Date;
  /** Whether auto-close is on, and from when (started_at). */
  autoCloseSince: string | null;
  /** Whether expiry is on, and from when. */
  expireSince: string | null;
  expiryDays: number;
  /** Share of doors the trail must reach. */
  coverageNeeded: number;
}

const DAY_MS = 86_400_000;

function latest(...dates: (string | null | undefined)[]): number {
  return Math.max(...dates.map((d) => (d ? Date.parse(d) : NaN)).filter((t) => Number.isFinite(t)), 0);
}

/**
 * What to do with one open play.
 *
 * Every close needs the thing that closed it to have happened after the
 * automation was switched on, and after the play was approved: a walk on
 * Tuesday does not close a round approved on Thursday.
 */
export function decideClosure(input: ClosureInput): ClosureDecision {
  const { play } = input;
  if (play.status !== "open") return { action: "none", why: "Not open." };

  if (input.autoCloseSince && isApproved(play.approval)) {
    const after = latest(input.autoCloseSince, play.approvedAt, play.createdAt);

    if (play.kind !== "flyers" && input.doors.length > 0) {
      const walked = input.trail.filter((p) => Date.parse(p.at) >= after);
      const coverage = trailCoverage(input.doors, walked);
      if (walked.length > 0 && coverage >= input.coverageNeeded) {
        return {
          action: "close",
          reason: "gps",
          coverage,
          note: `Walked: the trail passed ${Math.round(coverage * 100)}% of the doors.`,
        };
      }
    }

    if (play.kind !== "flyers" && input.crewFinishedAt && Date.parse(input.crewFinishedAt) >= after) {
      return { action: "close", reason: "crew_finished", note: "The crew tapped finished at the job this play was made for." };
    }
  }

  if (input.expireSince && Date.parse(play.createdAt) >= Date.parse(input.expireSince)) {
    const lastTrail = input.trail.length ? input.trail[input.trail.length - 1].at : null;
    const last = latest(play.createdAt, play.approvedAt, play.assignedAt, lastTrail);
    const idleDays = (input.now.getTime() - last) / DAY_MS;
    if (idleDays >= input.expiryDays) {
      return {
        action: "expire",
        note: `Expired: nothing happened on it for ${Math.floor(idleDays)} days${isApproved(play.approval) ? "" : ", and nobody approved it"}.`,
      };
    }
  }

  return { action: "none", why: "Still in progress." };
}

/**
 * The one-off the owner can start for the plays from before the switch: the
 * same rule, but on purpose and including the backlog.
 */
export function isStale(play: ClosablePlay, now: Date, expiryDays: number): boolean {
  if (play.status !== "open") return false;
  const last = latest(play.createdAt, play.approvedAt, play.assignedAt);
  return (now.getTime() - last) / DAY_MS >= expiryDays;
}

/** What a play cost, in cents: pieces times the cost of one. */
export function playCostCents(kind: ClosableKind, quantity: number, unitCostCents: Record<ClosableKind, number>): number {
  const pieces = kind === "yard_sign" ? 1 : Math.max(0, Math.round(quantity));
  return pieces * Math.max(0, unitCostCents[kind] ?? 0);
}

/** Cents per lead, or null when nothing has come in yet (not infinity, not zero). */
export function costPerLead(costCents: number, leads: number): number | null {
  if (leads <= 0) return null;
  return Math.round(costCents / leads);
}

export interface PlayResultLine {
  kind: ClosableKind;
  costCents: number;
  leads: number;
  sold: number;
}

export interface KindResult {
  kind: ClosableKind;
  plays: number;
  costCents: number;
  leads: number;
  sold: number;
  costPerLeadCents: number | null;
}

/** Cost per lead for each kind of play, from the finished ones. */
export function resultsByKind(lines: readonly PlayResultLine[]): KindResult[] {
  const by = new Map<ClosableKind, KindResult>();
  for (const l of lines) {
    const r = by.get(l.kind) ?? { kind: l.kind, plays: 0, costCents: 0, leads: 0, sold: 0, costPerLeadCents: null };
    r.plays++;
    r.costCents += l.costCents;
    r.leads += l.leads;
    r.sold += l.sold;
    by.set(l.kind, r);
  }
  return [...by.values()].map((r) => ({ ...r, costPerLeadCents: costPerLead(r.costCents, r.leads) }));
}

/** Open plays nobody has been given for more than three days: a needs-you item. */
export function unassignedTooLong<T extends { status: string; assignedTo?: string | null; approval?: string | null; approvedAt?: string | null; createdAt: string }>(
  plays: readonly T[],
  now: Date,
  days = 3
): T[] {
  return plays.filter(
    (p) => p.status === "open" && !p.assignedTo && (now.getTime() - Date.parse(p.approvedAt ?? p.createdAt)) / DAY_MS > days
  );
}

/**
 * A zone goes on the map only once somebody has said it is right.
 *
 * The build draws zones; a person approves them, one look at a time.
 * Every decision is kept with what the zone looked like, and from those
 * the app learns what an approved zone looks like. While it is new it
 * asks about every zone. After ten approvals in a row with no correction
 * it approves on its own the zones that look like ones already approved
 * (same mode, a similar number of doors, similar spacing) and asks only
 * about the unusual. After twenty-five it asks only about the
 * exceptional. One correction and it is back to asking about all of
 * them, because a correction means its idea of "right" was wrong.
 *
 * Pure: the zones and the decisions in, what to ask out.
 */

export type Approval = "pending" | "approved" | "auto" | "rejected";
export type Decision = "approve" | "reject" | "auto";
export type RejectReason = "mode" | "shape" | "walk" | "split" | "other";

/** How good the drawn route is, from `zone_walk_faults`. */
export type WalkQuality = "good" | "check" | "bad" | "unknown";

export interface WalkFault {
  kind: "disconnected" | "no_road_under_it" | "unsafe_crossing" | "doors_not_passed";
  severity: "check" | "bad";
  count: number;
  /** The fault in its own words, already worded for a person. */
  says: string;
}

export interface ZoneApprovalRow {
  id: string;
  name: string;
  approval: Approval;
  /** Never approved, rejected, or approved as something it no longer is. */
  needsApproval: boolean;
  mode: string | null;
  houses: number;
  gapM: number | null;
  pathKm: number | null;
  minutes: number | null;
  /** A "part N" zone split off a route. */
  isPart: boolean;
  /** Has an evaluation, a client or marketing to do in it. */
  active: boolean;
  approvedAt: string | null;
  note: string | null;
  /** Null on a zone that has not been walked since the check existed. */
  quality?: WalkQuality | null;
  faults?: WalkFault[];
}

export interface ZoneReview {
  zoneId: string | null;
  zoneName: string | null;
  decision: Decision;
  reason: string | null;
  note: string | null;
  mode: string | null;
  newMode: string | null;
  houses: number | null;
  gapM: number | null;
  pathKm: number | null;
  /** ISO. Newest first as listed. */
  at: string;
}

export const REJECT_REASONS: { key: RejectReason; label: string; blurb: string }[] = [
  { key: "mode", label: "Wrong way to cover it", blurb: "It should be walked, scootered or driven differently. Pick the right one and it is applied at once." },
  { key: "shape", label: "Wrong shape", blurb: "The outline takes in the wrong doors, or misses some." },
  { key: "walk", label: "Wrong walk or parking", blurb: "The order, the path or where to park is not how it should be done." },
  { key: "split", label: "Should be split", blurb: "Too much for one go, or two neighbourhoods in one." },
  { key: "other", label: "Something else", blurb: "Say what in the note." },
];

/** Approvals in a row, by a person, before the app approves like ones itself. */
export const ASK_ALL_UNTIL = 10;
/** Approvals in a row before the app asks only about the exceptional. */
export const ASK_UNUSUAL_UNTIL = 25;

export type TrustLevel = "ask_all" | "ask_unusual" | "ask_exceptional";

/**
 * How many approvals a person has given in a row since the last
 * correction. The app's own approvals do not count: they are not
 * evidence that it is right.
 */
export function approvalStreak(reviews: ZoneReview[]): number {
  let n = 0;
  for (const r of reviews) {
    if (r.decision === "reject") break;
    if (r.decision === "approve") n++;
  }
  return n;
}

export function trustLevel(streak: number): TrustLevel {
  if (streak >= ASK_UNUSUAL_UNTIL) return "ask_exceptional";
  if (streak >= ASK_ALL_UNTIL) return "ask_unusual";
  return "ask_all";
}

/** What an approved zone looks like, from the ones a person approved. */
export interface ApprovedShape {
  modes: Set<string>;
  houses: Record<string, { min: number; max: number }>;
  gap: Record<string, { min: number; max: number }>;
}

export function approvedShape(reviews: ZoneReview[]): ApprovedShape {
  const shape: ApprovedShape = { modes: new Set(), houses: {}, gap: {} };
  const widen = (table: Record<string, { min: number; max: number }>, key: string, value: number | null) => {
    if (value == null) return;
    const cur = table[key];
    table[key] = cur ? { min: Math.min(cur.min, value), max: Math.max(cur.max, value) } : { min: value, max: value };
  };
  for (const r of reviews) {
    if (r.decision !== "approve" || !r.mode) continue;
    shape.modes.add(r.mode);
    widen(shape.houses, r.mode, r.houses);
    widen(shape.gap, r.mode, r.gapM);
  }
  return shape;
}

export interface Policy {
  decision: "ask" | "auto";
  why: string;
}

/**
 * Whether to ask a person about this zone or approve it as the app.
 *
 * Auto only when the zone looks like ones a person has approved: a mode
 * they have approved before, doors and spacing within the range they
 * approved (a half wider each way while trust is new, twice as wide once
 * it is established). A split part always asks until trust is
 * established; it is the kind of zone the build gets wrong.
 */
export function approvalPolicy(zone: ZoneApprovalRow, shape: ApprovedShape, level: TrustLevel): Policy {
  // A bad route always asks, at every level of trust, and nothing below is
  // consulted. The app learned what an approved zone looks like from doors and
  // spacing, and a round that crosses a trunk road thirty-four times looks
  // exactly like a good one on both -- so the only thing that can tell them
  // apart is the fault report, and it outranks the learning entirely.
  const worst = worstFault(zone);
  if (worst) return { decision: "ask", why: worst.says };
  if (level === "ask_all") return { decision: "ask", why: "still learning what an approved zone looks like" };
  const mode = zone.mode ?? "";
  const slack = level === "ask_unusual" ? 0.5 : 1;
  if (!shape.modes.has(mode)) return { decision: "ask", why: `no ${mode || "such"} zone has been approved yet` };
  if (zone.isPart && level === "ask_unusual") return { decision: "ask", why: "a part split off a route" };
  const houses = shape.houses[mode];
  if (houses && (zone.houses < houses.min * (1 - slack) || zone.houses > houses.max * (1 + slack))) {
    return { decision: "ask", why: zone.houses > houses.max ? "more doors than any approved zone of its kind" : "fewer doors than any approved zone of its kind" };
  }
  const gap = shape.gap[mode];
  if (gap && zone.gapM != null && (zone.gapM < gap.min * (1 - slack) || zone.gapM > gap.max * (1 + slack))) {
    return { decision: "ask", why: zone.gapM > gap.max ? "doors further apart than any approved zone of its kind" : "doors closer together than any approved zone of its kind" };
  }
  return { decision: "auto", why: `like the ${mode} zones already approved` };
}

/**
 * The fault worth stopping an approval for, or null when there is none.
 *
 * Only the bad ones stop it. A round with a hundred and eight doors reached
 * from a back road is worth somebody's eye but is not dangerous, and stopping
 * every zone that has anything at all to say about it would make the queue the
 * manual work this app exists to remove.
 */
export function worstFault(zone: ZoneApprovalRow): WalkFault | null {
  if (zone.quality !== "bad") return null;
  const bad = (zone.faults ?? []).filter((f) => f.severity === "bad");
  // Crossing a main road on foot first: it is the only one that can hurt
  // somebody, rather than merely waste their morning.
  return bad.find((f) => f.kind === "unsafe_crossing") ?? bad[0] ?? null;
}

/** The zones waiting for a person, the ones with our work in them first, then the biggest. */
export function approvalQueue(zones: ZoneApprovalRow[]): ZoneApprovalRow[] {
  return zones
    .filter((z) => z.needsApproval)
    .sort((a, b) => Number(b.active) - Number(a.active) || b.houses - a.houses || a.name.localeCompare(b.name));
}

export interface ApprovalSummary {
  approved: number;
  byPerson: number;
  byApp: number;
  waiting: number;
  rejected: number;
}

export function summarizeApprovals(zones: ZoneApprovalRow[]): ApprovalSummary {
  const s: ApprovalSummary = { approved: 0, byPerson: 0, byApp: 0, waiting: 0, rejected: 0 };
  for (const z of zones) {
    if (z.needsApproval) {
      s.waiting++;
      if (z.approval === "rejected") s.rejected++;
      continue;
    }
    s.approved++;
    if (z.approval === "auto") s.byApp++;
    else s.byPerson++;
  }
  return s;
}

/** What the panel says about how much it is asking. */
export function describeTrust(streak: number): string {
  const level = trustLevel(streak);
  if (level === "ask_all") {
    const left = ASK_ALL_UNTIL - streak;
    return `Asking about every zone. ${streak} approved in a row so far; after ${left} more with no corrections, zones like the approved ones will be approved on their own.`;
  }
  if (level === "ask_unusual") {
    const left = ASK_UNUSUAL_UNTIL - streak;
    return `${streak} approved in a row. Zones like the approved ones are approved on their own now; only unusual ones are asked about. After ${left} more, only the exceptional.`;
  }
  return `${streak} approved in a row. Only exceptional zones are asked about. A correction puts it back to asking about every zone.`;
}

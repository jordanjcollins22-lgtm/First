import { RELATIONSHIP_STAGES, STAGE_LABEL } from "@/lib/house-relationship";
import type { MapPoint } from "@/lib/house-geojson";

/**
 * Cross-checks: the county's houses, sliced by everything at once.
 *
 * Every dot on the map carries where we stand, who owns it, whether it just
 * sold and whether a walkable USPS route passes it. A highlight is a
 * question over those -- "clients who rent", "owners on a walkable route
 * we have never spoken to" -- and the map shows only the dots that answer
 * yes. The matrix behind the panel is the same question counted.
 */

export interface PointHighlight {
  /** Stage ranks to keep; empty means any. */
  stages?: number[];
  /** 0 unknown, 1 owner-occupied, 2 absentee; empty means any. */
  ownership?: number[];
  /** Only houses sold in the last year. */
  soldRecently?: boolean;
  /** Only houses on a route that became a wave (true) or not (false). */
  walkableRoute?: boolean;
}

export const CLIENT_RANKS = [4, 5];
export const TALKED_RANKS = [1, 2, 3, 4, 5];

export interface HighlightPreset {
  key: string;
  label: string;
  why: string;
  highlight: PointHighlight;
}

export const HIGHLIGHT_PRESETS: HighlightPreset[] = [
  { key: "clients-renting", label: "Clients who rent", why: "The owner is elsewhere; the person paying us may move", highlight: { stages: CLIENT_RANKS, ownership: [2] } },
  { key: "clients-owning", label: "Clients who own", why: "The ones to ask for referrals and repeat work", highlight: { stages: CLIENT_RANKS, ownership: [1] } },
  { key: "talked-renting", label: "Spoken to, renting", why: "Worth knowing before quoting a long-term plan", highlight: { stages: TALKED_RANKS, ownership: [2] } },
  { key: "new-owners-untouched", label: "New owners, not spoken to", why: "Sold within the year and nobody has knocked", highlight: { stages: [0], soldRecently: true } },
  { key: "hanger-targets", label: "Owners on a walkable route, not spoken to", why: "The door-hanger walk's best doors", highlight: { stages: [0], ownership: [1], walkableRoute: true } },
  { key: "clients-off-route", label: "Clients no walk reaches", why: "Referral country: the route around them is hard or missing", highlight: { stages: CLIENT_RANKS, walkableRoute: false } },
];

/** Whether one of the map's points answers the question. */
export function matchesHighlight(point: MapPoint, h: PointHighlight | null): boolean {
  if (!h) return true;
  const s = Number(point[2]) || 0;
  const o = Number(point[3] ?? 0) || 0;
  const r = Number(point[4] ?? 0) || 0;
  const w = Number(point[5] ?? 0) || 0;
  if (h.stages && h.stages.length > 0 && !h.stages.includes(s)) return false;
  if (h.ownership && h.ownership.length > 0 && !h.ownership.includes(o)) return false;
  if (h.soldRecently && r !== 1) return false;
  if (h.walkableRoute === true && w !== 1) return false;
  if (h.walkableRoute === false && w === 1) return false;
  return true;
}

/** `[stageRank, ownership, walkableRoute, count]`, as the database counts them. */
export type MatrixRow = [number, number, number, number];

/** How many houses answer a question, from the counted matrix. */
export function countHighlight(rows: MatrixRow[], h: PointHighlight): number {
  return rows
    .filter(([s, o, w]) => matchesHighlight([0, 0, s, o, 0, w] as MapPoint, { ...h, soldRecently: false }))
    .reduce((sum, [, , , n]) => sum + n, 0);
}

export interface StageOwnershipRow {
  rank: number;
  label: string;
  owner: number;
  absentee: number;
  unknown: number;
  total: number;
}

/** The stage-by-ownership table for the panel, one row per stage that has anyone in it. */
export function stageOwnershipTable(rows: MatrixRow[]): StageOwnershipRow[] {
  return RELATIONSHIP_STAGES.map((stage, rank) => {
    const mine = rows.filter(([s]) => s === rank);
    const sum = (own: number) => mine.filter(([, o]) => o === own).reduce((t, [, , , n]) => t + n, 0);
    const owner = sum(1);
    const absentee = sum(2);
    const unknown = sum(0);
    return { rank, label: STAGE_LABEL[stage], owner, absentee, unknown, total: owner + absentee + unknown };
  }).filter((r) => r.total > 0);
}

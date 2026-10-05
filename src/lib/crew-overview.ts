/**
 * The manager's crew sheet: every area of the job at once, in the order the
 * work should go.
 *
 * The crew's sheet shows one area at a time, because that is how the work is
 * done. Whoever runs the job needs the opposite: the whole property on one
 * map, every area's instructions underneath, and what state each is in. This
 * puts the areas into stages a crew would actually work in: clear the ground
 * first, then trim, then the beds, lawns and washing, and anything going down
 * on cleared ground (sod, seed) last, once the clearing is hauled away.
 *
 * Pure, so the order can be tested without a database.
 */

import type { Point } from "@/components/canvas/types";

export type StageKey = "clear" | "trim" | "other" | "beds" | "lawn" | "wash" | "finish";

export interface CrewStage {
  key: StageKey;
  title: string;
  /** One line on why this stage comes where it does. */
  note: string;
  /** Map and badge colour. Works over a satellite photo in either theme. */
  color: string;
  /** Positions in the zones passed in, in the order to work them. */
  zones: number[];
  /** On the sod and seed stage: which of the two each area gets. */
  finish?: Record<number, "sod" | "seed">;
}

const STAGES: Record<StageKey, Omit<CrewStage, "key" | "zones">> = {
  clear: {
    title: "Clear and remove",
    note: "Clear the ground first, so everything after it has somewhere to go and the debris goes out in one haul.",
    color: "#ea580c",
  },
  trim: { title: "Trim", note: "Cut back to a maintained shape once the areas around them are open.", color: "#7c3aed" },
  other: { title: "Other work", note: "Areas with their own instructions.", color: "#0d9488" },
  beds: { title: "Beds and planting", note: "Weed, edge, refresh and plant the beds.", color: "#db2777" },
  lawn: { title: "Lawn", note: "Lawn work, after the beds so nobody walks over it finished.", color: "#16a34a" },
  wash: { title: "Washing", note: "Last, so dust and clippings from the rest are not washed back on.", color: "#0284c7" },
  finish: {
    title: "Sod and seed",
    note: "On ground cleared earlier in the job. Rake it level, lay it, roll it and water it in.",
    color: "#15803d",
  },
};

const ORDER: StageKey[] = ["clear", "trim", "other", "beds", "lawn", "wash", "finish"];

const STAGE_BY_TYPE: Record<string, StageKey> = {
  "plant-bush-removal": "clear",
  "landscape-cleanup": "clear",
  "leaf-seasonal-cleanup": "clear",
  grading: "clear",
  trimming: "trim",
  "landscape-bed": "beds",
  "plant-installation": "beds",
  "lawn-restoration": "lawn",
  "lawn-care": "lawn",
  "soft-washing": "wash",
};

export interface OverviewZone {
  typeId: string;
  /** The evaluator's answers, which say what goes down once it is cleared. */
  values: Record<string, string>;
  notes: string;
  points: Point[];
}

/** Which stage a service belongs to. A service we don't know is "other". */
export function stageForType(typeId: string): StageKey {
  return STAGE_BY_TYPE[typeId] ?? "other";
}

/**
 * Whether sod or seed goes down on this area once it is cleared.
 *
 * Only for clearing work: a lawn service already is the lawn work, and
 * listing it twice would send the crew to do it twice.
 */
export function getsSodOrSeedAfter(zone: OverviewZone): "sod" | "seed" | null {
  if (stageForType(zone.typeId) !== "clear") return null;
  const said = [zone.values.afterward, zone.values.afterward__other, zone.notes].filter(Boolean).join(" ");
  if (/\bsod\b/i.test(said)) return "sod";
  if (/\bseed(ed|ing)?\b/i.test(said) || zone.values.afterward === "Return to Lawn") return "seed";
  return null;
}

function centre(points: Point[]): Point | null {
  if (points.length === 0) return null;
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/**
 * Walks a stage's areas nearest-first from the first one the evaluator drew,
 * so the crew finish one part of the property before crossing to another.
 * Areas with no outline keep their place at the end.
 */
function walk(indices: number[], zones: OverviewZone[]): number[] {
  const placed = indices.filter((i) => centre(zones[i].points));
  const unplaced = indices.filter((i) => !centre(zones[i].points));
  if (placed.length === 0) return unplaced;
  const route = [placed[0]];
  const left = placed.slice(1);
  while (left.length > 0) {
    const here = centre(zones[route[route.length - 1]].points)!;
    let best = 0;
    let bestDistance = Infinity;
    left.forEach((i, k) => {
      const there = centre(zones[i].points)!;
      const distance = Math.hypot(there.x - here.x, there.y - here.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = k;
      }
    });
    route.push(left.splice(best, 1)[0]);
  }
  return [...route, ...unplaced];
}

/** The job's areas, staged and ordered. Empty stages are left out. */
export function planCrewStages(zones: OverviewZone[]): CrewStage[] {
  const byStage = new Map<StageKey, number[]>(ORDER.map((key) => [key, []]));
  const finish: Record<number, "sod" | "seed"> = {};
  zones.forEach((zone, i) => {
    byStage.get(stageForType(zone.typeId))!.push(i);
    const after = getsSodOrSeedAfter(zone);
    if (after) {
      byStage.get("finish")!.push(i);
      finish[i] = after;
    }
  });
  return ORDER.filter((key) => byStage.get(key)!.length > 0).map((key) => ({
    key,
    ...STAGES[key],
    zones: walk(byStage.get(key)!, zones),
    ...(key === "finish" ? { finish } : {}),
  }));
}

/** The stage an area is drawn in on the map: the first one it appears in. */
export function mapColorByZone(stages: CrewStage[], count: number): string[] {
  const colors: string[] = Array(count).fill(STAGES.other.color);
  const seen = new Set<number>();
  for (const stage of stages) {
    for (const i of stage.zones) {
      if (seen.has(i)) continue;
      seen.add(i);
      colors[i] = stage.color;
    }
  }
  return colors;
}

/** Instruction lines that say what to leave alone, to set apart from the rest. */
export function isKeepLine(line: string): boolean {
  return /^(leave these|keep|do not remove|don't remove)\b/i.test(line.trim());
}

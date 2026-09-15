import type { JourneyStep } from "@/types/domain";

export interface JourneyEdge {
  from: string;
  to: string;
}

export interface JourneyLayout {
  /** Steps grouped left-to-right by distance from the journey's starting point(s). */
  columns: JourneyStep[][];
  /** Edges that flow forward (drawn as connector lines between columns). */
  forwardEdges: JourneyEdge[];
  /** Edges that loop back to an earlier or same step (drawn as a small loop badge, not a line across columns). */
  backEdges: JourneyEdge[];
}

/**
 * Lays a journey out as a tree/flowchart: steps nothing points to are the
 * roots (column 0), and every other step sits one column past whichever of
 * its parents placed it first. Real journeys loop (review a zone, then
 * draw another) — a next_steps entry pointing at an already-placed step is
 * a "back edge" and drawn as a loop rather than stretched across columns.
 */
export function computeJourneyLayout(steps: JourneyStep[]): JourneyLayout {
  const byKey = new Map(steps.map((s) => [s.step_key, s]));
  const parentCount = new Map<string, number>();
  for (const step of steps) {
    for (const next of step.next_steps) {
      if (!byKey.has(next)) continue;
      parentCount.set(next, (parentCount.get(next) ?? 0) + 1);
    }
  }

  const roots = steps.filter((s) => (parentCount.get(s.step_key) ?? 0) === 0);
  const depth = new Map<string, number>();
  const visited = new Set<string>();
  const forwardEdges: JourneyEdge[] = [];
  const backEdges: JourneyEdge[] = [];

  function visit(key: string, atDepth: number) {
    if (visited.has(key)) return;
    visited.add(key);
    depth.set(key, atDepth);
    const step = byKey.get(key);
    if (!step) return;
    for (const next of step.next_steps) {
      if (!byKey.has(next)) continue;
      if (visited.has(next)) {
        backEdges.push({ from: key, to: next });
      } else {
        forwardEdges.push({ from: key, to: next });
        visit(next, atDepth + 1);
      }
    }
  }

  for (const root of roots) visit(root.step_key, 0);
  // Anything unreachable from a root (shouldn't normally happen) still needs a column.
  for (const step of steps) if (!visited.has(step.step_key)) visit(step.step_key, 0);

  const columns: JourneyStep[][] = [];
  for (const step of steps) {
    const d = depth.get(step.step_key) ?? 0;
    (columns[d] ??= []).push(step);
  }

  return { columns, forwardEdges, backEdges };
}

/**
 * Lines of a breakdown, sorted into the stages of a pipeline.
 *
 * A person's row on a leaderboard opens to everything behind it, and a
 * flat list of forty jobs in date order says nothing about where they are.
 * Grouped by stage in the order the stages happen, the same list reads as
 * a funnel: this many waiting, this many under way, this many done.
 * Stages with nothing in them are left out rather than printed empty.
 */
export interface StageGroup<S extends string, T> {
  stage: S;
  lines: T[];
}

export function groupByStage<S extends string, T>(lines: readonly T[], stageOf: (line: T) => S, order: readonly S[]): StageGroup<S, T>[] {
  const buckets = new Map<S, T[]>();
  for (const line of lines) {
    const stage = stageOf(line);
    const bucket = buckets.get(stage) ?? [];
    bucket.push(line);
    buckets.set(stage, bucket);
  }
  const known = new Set(order);
  const groups: StageGroup<S, T>[] = order
    .filter((stage) => buckets.has(stage))
    .map((stage) => ({ stage, lines: buckets.get(stage) as T[] }));
  // A stage the order forgot still shows, at the end, rather than vanishing.
  for (const [stage, bucket] of buckets) {
    if (!known.has(stage)) groups.push({ stage, lines: bucket });
  }
  return groups;
}

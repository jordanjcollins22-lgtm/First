/**
 * Generates a recommended work sequence/route across zones (and across
 * work areas within a zone) using simple nearest-neighbor
 * distance-minimization. Not a true TSP solver — good enough for the
 * small number of stops on a residential/commercial property, and it's
 * always presented as a *recommendation* the estimator can reorder.
 */
import * as turf from "@turf/turf";

export interface SequenceableItem {
  id: string;
  centroid: [number, number];
}

/**
 * Returns item ids in nearest-neighbor visiting order, starting from the
 * item closest to `startPoint` (e.g. the property's street-facing point,
 * or the first zone's centroid if no reference is given).
 */
export function nearestNeighborSequence(
  items: SequenceableItem[],
  startPoint?: [number, number]
): string[] {
  if (items.length === 0) return [];

  const remaining = [...items];
  const order: string[] = [];

  let currentPoint =
    startPoint ??
    remaining.reduce(
      (acc, item) => [acc[0] + item.centroid[0], acc[1] + item.centroid[1]],
      [0, 0]
    ).map((v) => v / remaining.length) as [number, number];

  while (remaining.length > 0) {
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = turf.distance(
        turf.point(currentPoint),
        turf.point(remaining[i].centroid),
        { units: "feet" }
      );
      if (d < nearestDistance) {
        nearestDistance = d;
        nearestIndex = i;
      }
    }
    const [next] = remaining.splice(nearestIndex, 1);
    order.push(next.id);
    currentPoint = next.centroid;
  }

  return order;
}

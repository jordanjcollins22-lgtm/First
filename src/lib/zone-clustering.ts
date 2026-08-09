/**
 * Auto-clusters WorkAreas into Zones by geographic proximity.
 *
 * v1 approach: single-linkage agglomerative clustering on work area
 * centroids with a fixed distance threshold. This is intentionally simple
 * (no ML) — zones are always manually renameable/overridable afterward,
 * so getting the initial grouping "roughly right" is the goal, not
 * perfect for every property layout.
 */
import * as turf from "@turf/turf";
import type { Feature, Geometry } from "geojson";

const DEFAULT_CLUSTER_DISTANCE_FT = 75;

export interface ClusterableWorkArea {
  id: string;
  geometry: Feature<Geometry>;
}

export interface ZoneCluster {
  /** Zone label, e.g. "Zone A". Caller may rename/override afterward. */
  name: string;
  workAreaIds: string[];
  centroid: [number, number];
}

function centroidOf(feature: Feature<Geometry>): [number, number] {
  const c = turf.centroid(feature);
  return c.geometry.coordinates as [number, number];
}

function distanceFt(a: [number, number], b: [number, number]): number {
  return turf.distance(turf.point(a), turf.point(b), { units: "feet" });
}

function zoneName(index: number): string {
  // A, B, C ... Z, AA, AB, ...
  let n = index;
  let name = "";
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Zone ${name}`;
}

/**
 * Single-linkage clustering: two work areas join the same cluster if any
 * pair of members is within `distanceThresholdFt` of each other.
 */
export function clusterWorkAreasIntoZones(
  workAreas: ClusterableWorkArea[],
  distanceThresholdFt: number = DEFAULT_CLUSTER_DISTANCE_FT
): ZoneCluster[] {
  if (workAreas.length === 0) return [];

  const centroids = new Map<string, [number, number]>();
  for (const wa of workAreas) {
    centroids.set(wa.id, centroidOf(wa.geometry));
  }

  // Union-find over work area ids.
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const wa of workAreas) parent.set(wa.id, wa.id);

  for (let i = 0; i < workAreas.length; i++) {
    for (let j = i + 1; j < workAreas.length; j++) {
      const a = workAreas[i];
      const b = workAreas[j];
      const d = distanceFt(centroids.get(a.id)!, centroids.get(b.id)!);
      if (d <= distanceThresholdFt) {
        union(a.id, b.id);
      }
    }
  }

  const groups = new Map<string, string[]>();
  for (const wa of workAreas) {
    const root = find(wa.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(wa.id);
  }

  // Order clusters west-to-east, then north-to-south, for stable, sensible
  // naming (Zone A near the road/front, etc. is a future refinement).
  const clusters = Array.from(groups.values()).map((ids) => {
    const pts = ids.map((id) => centroids.get(id)!);
    const avgLng = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const avgLat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return { ids, centroid: [avgLng, avgLat] as [number, number] };
  });

  clusters.sort((a, b) => a.centroid[0] - b.centroid[0] || b.centroid[1] - a.centroid[1]);

  return clusters.map((c, index) => ({
    name: zoneName(index),
    workAreaIds: c.ids,
    centroid: c.centroid,
  }));
}

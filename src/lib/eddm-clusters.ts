/**
 * The houses no USPS route reaches, grouped into what they probably are.
 *
 * The database buckets unreached houses into cells of about a hundred and
 * fifty metres. Here neighbouring cells are joined, because a development
 * under construction is bigger than one cell and should read as one thing.
 * Then each group is judged by its size: a house or three beside a route are
 * doors the walk should take in -- a corner lot, a flag lot, a new house on
 * an old street -- and a couple of dozen together are a subdivision USPS has
 * not caught up with, which is worth knowing about for its own sake.
 */

export interface UnservedCell {
  cx: number;
  cy: number;
  count: number;
  lat: number;
  lng: number;
  sample: string;
  zip: string | null;
}

export type ClusterKind = "missed_doors" | "development";

export interface UnservedCluster {
  id: string;
  kind: ClusterKind;
  houses: number;
  cells: number;
  lat: number;
  lng: number;
  /** One address from the group, so it can be found on the map and by name. */
  sample: string;
  zip: string | null;
}

/** From this many houses up, a group is a development rather than a few missed doors. */
export const DEVELOPMENT_AT = 5;

/** Joins touching cells (8-neighbour) into groups. */
export function clusterCells(cells: UnservedCell[]): UnservedCluster[] {
  const key = (cx: number, cy: number) => `${cx}:${cy}`;
  const byKey = new Map(cells.map((c) => [key(c.cx, c.cy), c]));
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = k;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const cell of cells) parent.set(key(cell.cx, cell.cy), key(cell.cx, cell.cy));
  for (const cell of cells) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const neighbour = key(cell.cx + dx, cell.cy + dy);
        if (byKey.has(neighbour)) union(key(cell.cx, cell.cy), neighbour);
      }
    }
  }

  const groups = new Map<string, UnservedCell[]>();
  for (const cell of cells) {
    const root = find(key(cell.cx, cell.cy));
    groups.set(root, [...(groups.get(root) ?? []), cell]);
  }

  return [...groups.entries()]
    .map(([id, members]) => {
      const houses = members.reduce((sum, c) => sum + c.count, 0);
      const lat = members.reduce((sum, c) => sum + c.lat * c.count, 0) / houses;
      const lng = members.reduce((sum, c) => sum + c.lng * c.count, 0) / houses;
      const biggest = [...members].sort((a, b) => b.count - a.count)[0];
      return {
        id,
        kind: houses >= DEVELOPMENT_AT ? ("development" as const) : ("missed_doors" as const),
        houses,
        cells: members.length,
        lat: Math.round(lat * 1e6) / 1e6,
        lng: Math.round(lng * 1e6) / 1e6,
        sample: biggest.sample,
        zip: biggest.zip,
      };
    })
    .sort((a, b) => b.houses - a.houses);
}

/** What the screen says about the groups as a whole. */
export function describeClusters(clusters: UnservedCluster[]): string {
  const developments = clusters.filter((c) => c.kind === "development");
  const missed = clusters.filter((c) => c.kind === "missed_doors");
  const devHouses = developments.reduce((s, c) => s + c.houses, 0);
  const missedHouses = missed.reduce((s, c) => s + c.houses, 0);
  if (clusters.length === 0) return "Every house is within reach of a USPS route.";
  return [
    developments.length > 0 ? `${developments.length} likely developments (${devHouses.toLocaleString()} houses)` : null,
    missed.length > 0 ? `${missed.length} spots of a few missed doors (${missedHouses.toLocaleString()} houses)` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

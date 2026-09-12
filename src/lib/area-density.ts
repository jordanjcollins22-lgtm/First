/**
 * Where the work actually is, and where the money actually came from.
 *
 * Two different questions that look like one. "Where are most of our
 * addresses" tells you where to walk a street. "Where did the money come
 * from" tells you where to walk it first — and the two answers are routinely
 * different, because the densest part of a county is usually the part with the
 * smallest lots.
 *
 * Ranked in grid cells rather than by town, because a town boundary is a
 * political line and a marketing decision is a geographic one. Half a mile of
 * three-acre lots that happens to straddle two townships is one place to a
 * person driving to it.
 */

export interface DensityPoint {
  lat: number;
  lng: number;
  /** Money actually collected against this address, all time. Zero for a
   * property nobody has worked yet, which is most of them. */
  collected: number;
  /** Jobs done here, so a cell can say how many rather than only how much. */
  jobs: number;
  /** Best label for the area — the town from the address. */
  area: string;
}

export interface DensityCell {
  key: string;
  /** The cell's own square, as [west, south, east, north]. Drawn as a boundary
   * rather than a blurred dot: an outline says "this area, these streets",
   * and a soft blob says "somewhere around here", which is not a place
   * anybody can be sent. */
  bounds: [number, number, number, number];
  /** Centre of the cell, for drawing. */
  lat: number;
  lng: number;
  /** Addresses inside it. */
  count: number;
  /** Money collected inside it. */
  collected: number;
  jobs: number;
  /** The town most of it sits in, for reading out. */
  area: string;
}

/**
 * A run of touching cells, treated as one place.
 *
 * Without this, a town that covers six half-mile cells appears six times in a
 * top ten, and a ranked list reading "Bel Air, Aberdeen, Bel Air, Aberdeen"
 * looks broken even though every row is technically correct. Two squares that
 * share an edge or a corner are one place to somebody driving to them, so they
 * are one row.
 */
export interface DensityArea {
  key: string;
  /** The cells it is made of, for drawing the real shape rather than a box
   * around it — an L-shaped run of streets is not a rectangle. */
  cells: DensityCell[];
  /** Everything it covers, for flying the map to it. */
  bounds: [number, number, number, number];
  lat: number;
  lng: number;
  count: number;
  collected: number;
  jobs: number;
  area: string;
}

export type DensityMode = "count" | "paid";

export const DENSITY_MODES: { value: DensityMode; label: string; blurb: string }[] = [
  { value: "count", label: "Most addresses", blurb: "Where we hold the most addresses." },
  { value: "paid", label: "Most paid work", blurb: "Where the money actually came from." },
];

/**
 * Roughly half a mile at this latitude.
 *
 * Chosen to be about a morning's door-knocking rather than to be a round
 * number. A cell somebody cannot walk in a session is not a decision they can
 * act on.
 */
export const CELL_DEGREES = 0.01;

function cellKey(lat: number, lng: number, size: number): string {
  return `${Math.floor(lat / size)}:${Math.floor(lng / size)}`;
}

/**
 * Buckets addresses into cells and adds them up.
 *
 * The cell's label is whichever town most of its addresses claim — cells do
 * not respect town boundaries, and picking the most common is more useful than
 * picking the first or admitting defeat with "mixed".
 */
export function densityCells(points: DensityPoint[], size = CELL_DEGREES): DensityCell[] {
  const cells = new Map<
    string,
    { latSum: number; lngSum: number; count: number; collected: number; jobs: number; areas: Map<string, number> }
  >();

  for (const point of points) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    const key = cellKey(point.lat, point.lng, size);
    const cell = cells.get(key) ?? {
      latSum: 0,
      lngSum: 0,
      count: 0,
      collected: 0,
      jobs: 0,
      areas: new Map<string, number>(),
    };
    cell.latSum += point.lat;
    cell.lngSum += point.lng;
    cell.count += 1;
    cell.collected += point.collected;
    cell.jobs += point.jobs;
    if (point.area) cell.areas.set(point.area, (cell.areas.get(point.area) ?? 0) + 1);
    cells.set(key, cell);
  }

  return [...cells.entries()].map(([key, cell]) => {
    const [latIndex, lngIndex] = key.split(":").map(Number);
    let area = "Unknown";
    let best = 0;
    for (const [name, n] of cell.areas) {
      if (n > best) {
        best = n;
        area = name;
      }
    }
    return {
      key,
      bounds: [
        lngIndex * size,
        latIndex * size,
        (lngIndex + 1) * size,
        (latIndex + 1) * size,
      ] as [number, number, number, number],
      // The average of what is in it, not the corner of the box — it puts the
      // label where the houses are rather than on an arbitrary gridline.
      lat: cell.latSum / cell.count,
      lng: cell.lngSum / cell.count,
      count: cell.count,
      collected: Math.round(cell.collected),
      jobs: cell.jobs,
      area,
    };
  });
}

/**
 * Joins cells that touch into single areas.
 *
 * Eight-connected: diagonally adjacent counts, because a neighbourhood that
 * runs corner to corner across a grid line is still one neighbourhood, and the
 * grid line is an artefact of how this is counted rather than anything on the
 * ground.
 */
export function clusterCells(cells: DensityCell[]): DensityArea[] {
  const byKey = new Map(cells.map((c) => [c.key, c]));
  const seen = new Set<string>();
  const areas: DensityArea[] = [];

  for (const cell of cells) {
    if (seen.has(cell.key)) continue;

    // Flood fill from this cell, taking every neighbour it can reach.
    const group: DensityCell[] = [];
    const queue = [cell.key];
    seen.add(cell.key);

    while (queue.length > 0) {
      const key = queue.pop() as string;
      const current = byKey.get(key);
      if (!current) continue;
      group.push(current);

      const [latIndex, lngIndex] = key.split(":").map(Number);
      for (let dLat = -1; dLat <= 1; dLat++) {
        for (let dLng = -1; dLng <= 1; dLng++) {
          if (dLat === 0 && dLng === 0) continue;
          const neighbour = `${latIndex + dLat}:${lngIndex + dLng}`;
          if (byKey.has(neighbour) && !seen.has(neighbour)) {
            seen.add(neighbour);
            queue.push(neighbour);
          }
        }
      }
    }

    const count = group.reduce((sum, c) => sum + c.count, 0);
    const areaNames = new Map<string, number>();
    for (const c of group) areaNames.set(c.area, (areaNames.get(c.area) ?? 0) + c.count);
    let label = "Unknown";
    let best = 0;
    for (const [name, n] of areaNames) {
      if (n > best) {
        best = n;
        label = name;
      }
    }

    areas.push({
      key: group.map((c) => c.key).sort().join("|"),
      cells: group,
      bounds: [
        Math.min(...group.map((c) => c.bounds[0])),
        Math.min(...group.map((c) => c.bounds[1])),
        Math.max(...group.map((c) => c.bounds[2])),
        Math.max(...group.map((c) => c.bounds[3])),
      ],
      // Weighted by how many addresses each cell holds, so the label sits
      // over the busy end of a long run rather than its geometric middle.
      lat: group.reduce((sum, c) => sum + c.lat * c.count, 0) / Math.max(1, count),
      lng: group.reduce((sum, c) => sum + c.lng * c.count, 0) / Math.max(1, count),
      count,
      collected: group.reduce((sum, c) => sum + c.collected, 0),
      jobs: group.reduce((sum, c) => sum + c.jobs, 0),
      area: label,
    });
  }

  return areas;
}

/**
 * Tells apart two genuinely separate pockets that share a town name.
 *
 * Clustering removes nearly all of these, but a town really can have two
 * unconnected patches of our addresses in it, and printing the same name twice
 * with no way to tell which is which is the thing being fixed here — so the
 * survivors get a compass point rather than being left ambiguous.
 */
export function disambiguate(areas: DensityArea[]): DensityArea[] {
  const counts = new Map<string, number>();
  for (const a of areas) counts.set(a.area, (counts.get(a.area) ?? 0) + 1);

  return areas.map((area) => {
    if ((counts.get(area.area) ?? 0) < 2) return area;

    const siblings = areas.filter((a) => a.area === area.area);
    const meanLat = siblings.reduce((sum, a) => sum + a.lat, 0) / siblings.length;
    const meanLng = siblings.reduce((sum, a) => sum + a.lng, 0) / siblings.length;

    const dLat = area.lat - meanLat;
    const dLng = area.lng - meanLng;
    const compass =
      Math.abs(dLat) >= Math.abs(dLng) ? (dLat >= 0 ? "north" : "south") : dLng >= 0 ? "east" : "west";

    return { ...area, area: `${area.area} (${compass})` };
  });
}

/**
 * The areas worth looking at, best first.
 *
 * In paid mode, cells that have never earned anything are dropped rather than
 * ranked last. A list of the top ten places by money that is eight zeroes is
 * not a ranking, it is a list of places with a zero next to them.
 */
export function rankAreas(areas: DensityArea[], mode: DensityMode, limit = 10): DensityArea[] {
  const scored = mode === "paid" ? areas.filter((c) => c.collected > 0) : areas.filter((c) => c.count > 0);

  return scored
    .sort((a, b) => {
      if (mode === "paid") {
        if (b.collected !== a.collected) return b.collected - a.collected;
        return b.count - a.count;
      }
      if (b.count !== a.count) return b.count - a.count;
      // A tie on addresses is broken by which has earned, because that is the
      // one worth going back to.
      return b.collected - a.collected;
    })
    .slice(0, limit);
}

/**
 * A cell's weight against the strongest one, for colouring.
 *
 * Relative rather than absolute, because the numbers differ by orders of
 * magnitude between a book of two hundred addresses and one of ninety
 * thousand, and a fixed scale would render one of them entirely one colour.
 */
export function intensityOf(cell: DensityArea, cells: DensityArea[], mode: DensityMode): number {
  const value = mode === "paid" ? cell.collected : cell.count;
  const max = cells.reduce((best, c) => Math.max(best, mode === "paid" ? c.collected : c.count), 0);
  if (max <= 0) return 0;
  return Math.min(1, value / max);
}

/** What a cell is worth per address — the number that says whether a dense
 * area is dense with work or merely dense with houses. */
export function valuePerAddress(cell: Pick<DensityArea, "count" | "collected">): number {
  if (cell.count === 0) return 0;
  return Math.round(cell.collected / cell.count);
}

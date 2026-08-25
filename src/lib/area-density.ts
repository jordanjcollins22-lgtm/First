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
      // The average of what is in it, not the corner of the box — it puts the
      // marker where the houses are rather than on an arbitrary gridline.
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
 * The cells worth looking at, best first.
 *
 * In paid mode, cells that have never earned anything are dropped rather than
 * ranked last. A list of the top ten places by money that is eight zeroes is
 * not a ranking, it is a list of places with a zero next to them.
 */
export function rankCells(cells: DensityCell[], mode: DensityMode, limit = 10): DensityCell[] {
  const scored = mode === "paid" ? cells.filter((c) => c.collected > 0) : cells.filter((c) => c.count > 0);

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
export function intensityOf(cell: DensityCell, cells: DensityCell[], mode: DensityMode): number {
  const value = mode === "paid" ? cell.collected : cell.count;
  const max = cells.reduce((best, c) => Math.max(best, mode === "paid" ? c.collected : c.count), 0);
  if (max <= 0) return 0;
  return Math.min(1, value / max);
}

/** What a cell is worth per address — the number that says whether a dense
 * area is dense with work or merely dense with houses. */
export function valuePerAddress(cell: DensityCell): number {
  if (cell.count === 0) return 0;
  return Math.round(cell.collected / cell.count);
}

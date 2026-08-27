/**
 * Where we show up, and where we don't.
 *
 * A single "we rank #4 for lawn care" is close to meaningless: local results
 * move with where the person searching is standing. Two streets apart can be
 * first place and nowhere. So the question is not a number, it is a map —
 * a grid of points around the yard, each one asking "if somebody searched
 * from here, where would we come?"
 *
 * That is what this builds: the points, and what the answers mean once you
 * have them.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GridPoint extends LatLng {
  /** 0 at the top (north). */
  row: number;
  /** 0 at the left (west). */
  col: number;
}

/** Odd sizes only, so there is always a point on the business itself. */
export const GRID_SIZES = [3, 5, 7, 9] as const;
export type GridSize = (typeof GRID_SIZES)[number];

export const DEFAULT_GRID_SIZE: GridSize = 7;
export const DEFAULT_SPACING_MILES = 1;

const MILES_PER_DEGREE_LAT = 69.0;

/**
 * The points to search from.
 *
 * Spaced in miles rather than degrees, because a degree of longitude in
 * Maryland is about three quarters of a degree of latitude — a grid built on
 * raw degrees comes out squashed, and the corners end up asking about
 * somewhere other than where they are drawn.
 */
export function buildGrid(
  centre: LatLng,
  size: GridSize = DEFAULT_GRID_SIZE,
  spacingMiles: number = DEFAULT_SPACING_MILES
): GridPoint[] {
  const half = (size - 1) / 2;
  const latStep = spacingMiles / MILES_PER_DEGREE_LAT;
  const milesPerDegreeLng = MILES_PER_DEGREE_LAT * Math.cos((centre.lat * Math.PI) / 180);
  const lngStep = spacingMiles / milesPerDegreeLng;

  const points: GridPoint[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      points.push({
        row,
        col,
        // Row 0 is the top of the map, which is the highest latitude.
        lat: centre.lat + (half - row) * latStep,
        lng: centre.lng + (col - half) * lngStep,
      });
    }
  }
  return points;
}

/** How wide the whole grid is, corner to corner, in miles. */
export function gridSpanMiles(size: GridSize, spacingMiles: number): number {
  return (size - 1) * spacingMiles;
}

// ============================================================
// What the answers mean
// ============================================================

export type RankBand = "top3" | "top10" | "top20" | "beyond" | "unranked";

export interface BandStyle {
  band: RankBand;
  label: string;
  colour: string;
}

/**
 * The bands, and why they are where they are.
 *
 * Three, because the local pack shows three and everything below it is a
 * second click. Ten, because that is the first page. Twenty, because past
 * twenty nobody is looking and the exact number stops mattering.
 */
export const BANDS: Record<RankBand, BandStyle> = {
  top3: { band: "top3", label: "In the pack (1-3)", colour: "#16a34a" },
  top10: { band: "top10", label: "First page (4-10)", colour: "#84cc16" },
  top20: { band: "top20", label: "Second page (11-20)", colour: "#f59e0b" },
  beyond: { band: "beyond", label: "Past 20", colour: "#ef4444" },
  unranked: { band: "unranked", label: "Not found", colour: "#6b7280" },
};

/** Where a result sits. Null rank means we were not in the results at all. */
export function rankBand(rank: number | null): RankBand {
  if (rank == null || rank <= 0) return "unranked";
  if (rank <= 3) return "top3";
  if (rank <= 10) return "top10";
  if (rank <= 20) return "top20";
  return "beyond";
}

export function bandColour(rank: number | null): string {
  return BANDS[rankBand(rank)].colour;
}

/** What a point shows on the map. A dash where we did not appear at all. */
export function rankLabel(rank: number | null): string {
  if (rank == null || rank <= 0) return "–";
  return rank > 20 ? "20+" : String(rank);
}

export interface ScanPoint {
  row: number;
  col: number;
  lat: number;
  lng: number;
  rank: number | null;
}

/**
 * The average place across the grid.
 *
 * Not-found counts as one worse than the worst place we track, rather than
 * being left out. Dropping them would make a grid where we appear at three
 * points out of forty-nine and nowhere else read as an average of 2.0, which
 * is the most flattering possible lie about it.
 */
export const UNRANKED_PENALTY = 21;

export function averageRank(points: ScanPoint[]): number | null {
  if (points.length === 0) return null;
  const total = points.reduce(
    (sum, point) => sum + (point.rank != null && point.rank > 0 ? Math.min(point.rank, UNRANKED_PENALTY) : UNRANKED_PENALTY),
    0
  );
  return total / points.length;
}

/** The share of the map where we are in the three-result pack. */
export function packShare(points: ScanPoint[]): number {
  if (points.length === 0) return 0;
  return points.filter((point) => rankBand(point.rank) === "top3").length / points.length;
}

/** How many points fall in each band, for the legend. */
export function bandCounts(points: ScanPoint[]): Record<RankBand, number> {
  const counts: Record<RankBand, number> = {
    top3: 0,
    top10: 0,
    top20: 0,
    beyond: 0,
    unranked: 0,
  };
  for (const point of points) counts[rankBand(point.rank)]++;
  return counts;
}

/**
 * Which way it is going.
 *
 * Positive is better, because a rank going down is a good thing and a graph
 * that goes down when things improve is a graph people misread.
 */
export function movement(current: ScanPoint[], previous: ScanPoint[]): number | null {
  const now = averageRank(current);
  const before = averageRank(previous);
  if (now == null || before == null) return null;
  return before - now;
}

/**
 * The points worth doing something about.
 *
 * Not the worst points — the ones nearest the business that are still bad.
 * Being invisible eight miles out is expected; being invisible two streets
 * away is a problem with a fix.
 */
export function weakSpotsNearBase(
  points: ScanPoint[],
  centre: LatLng,
  limit = 5
): ScanPoint[] {
  return points
    .filter((point) => {
      const band = rankBand(point.rank);
      return band !== "top3" && band !== "top10";
    })
    .map((point) => ({ point, distance: roughMiles(centre, point) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((entry) => entry.point);
}

/** Good enough for ordering points on one grid. */
function roughMiles(from: LatLng, to: LatLng): number {
  const dLat = (to.lat - from.lat) * MILES_PER_DEGREE_LAT;
  const dLng =
    (to.lng - from.lng) * MILES_PER_DEGREE_LAT * Math.cos((from.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

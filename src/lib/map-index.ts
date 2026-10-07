/**
 * One list of the things on the map worth going to.
 *
 * The map knew about finished jobs and about USPS routes and offered no way to
 * walk either. Finding the job we closed last Thursday meant panning until a
 * pin looked familiar, and finding a particular carrier route meant knowing
 * its number by heart.
 *
 * So both are listed, in the order somebody actually wants them: the work we
 * have just finished at the top, because that is where the next job comes from
 * — a fresh lawn is the best advertisement on the street — and the routes
 * under it, because that is the other way onto the same street.
 *
 * The grouping does not move. Jobs are above routes whichever way the list is
 * sorted, because they are different kinds of thing and a list that shuffles
 * them together is one nobody can scan. The sort orders within each group.
 */

export type EntryKind = "job" | "route";

export interface MapEntry {
  kind: EntryKind;
  id: string;
  title: string;
  /** The line under it: an address, or a ZIP and a count. */
  subtitle: string;
  /** When the job was signed off. Null for a route, which has no such date. */
  closedAt: string | null;
  /** Deliveries on a route, or what a job was worth. Null when unknown. */
  size: number | null;
  lat: number | null;
  lng: number | null;
}

export type SortKey = "recent" | "name" | "size";
export type Direction = "desc" | "asc";

export const SORTS: { key: SortKey; label: string; hint: string }[] = [
  { key: "recent", label: "Newest", hint: "Most recently finished first" },
  { key: "name", label: "Name", hint: "Alphabetical" },
  { key: "size", label: "Size", hint: "Biggest first: deliveries on a route, value on a job" },
];

/** What clicking a sort that is already on does: turns it round. */
export function nextDirection(current: SortKey, clicked: SortKey, direction: Direction): Direction {
  if (current !== clicked) return defaultDirection(clicked);
  return direction === "desc" ? "asc" : "desc";
}

/** Newest and biggest read best downwards; a name reads best upwards. */
export function defaultDirection(key: SortKey): Direction {
  return key === "name" ? "asc" : "desc";
}

/**
 * The list, in order.
 *
 * Jobs first, then routes, and the chosen sort applied inside each. A route
 * has no closing date, so under "newest" they fall back to size — which is
 * the only ordering of a carrier route that means anything.
 */
export function sortEntries(entries: MapEntry[], key: SortKey, direction: Direction): MapEntry[] {
  const flip = direction === "asc" ? -1 : 1;

  const compare = (a: MapEntry, b: MapEntry): number => {
    if (key === "name") return a.title.localeCompare(b.title) * (direction === "asc" ? 1 : -1);
    if (key === "size") return ((b.size ?? -1) - (a.size ?? -1)) * flip;
    // Newest. Anything without a date sorts by size instead of landing in a
    // random order, which is what a route needs.
    const at = (entry: MapEntry) => (entry.closedAt ? new Date(entry.closedAt).getTime() : NaN);
    const aAt = at(a);
    const bAt = at(b);
    if (Number.isNaN(aAt) && Number.isNaN(bAt)) return ((b.size ?? -1) - (a.size ?? -1)) * flip;
    if (Number.isNaN(aAt)) return 1;
    if (Number.isNaN(bAt)) return -1;
    return (bAt - aAt) * flip;
  };

  const jobs = entries.filter((e) => e.kind === "job").sort(compare);
  const routes = entries.filter((e) => e.kind === "route").sort(compare);
  return [...jobs, ...routes];
}

/** Whether there is anywhere to fly to. A row with no pin is a row that cannot be opened. */
export function hasPlace(entry: MapEntry): boolean {
  return entry.lat != null && entry.lng != null && Number.isFinite(entry.lat) && Number.isFinite(entry.lng);
}

/** The centre of a ring of coordinates, for a route that is a shape not a pin. */
export function centreOf(ring: [number, number][]): { lat: number; lng: number } | null {
  const points = ring.filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
  if (points.length === 0) return null;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  // The middle of the box rather than the average of the points, so a route
  // with a dense cul-de-sac at one end still centres on the whole of itself.
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}

/** How long ago, in the fewest words that are still true. */
export function closedLabel(closedAt: string | null, now: Date = new Date()): string | null {
  if (!closedAt) return null;
  const at = new Date(closedAt);
  if (Number.isNaN(at.getTime())) return null;

  const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000);
  if (days < 0) return "Just now";
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "Last week";
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

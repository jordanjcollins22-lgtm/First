/**
 * Saying what order a round is walked in, by hand.
 *
 * The router works out a good order and it is usually right, but it does not
 * know that this cul-de-sac is easier from the top, or that the crew parks by
 * the school and works outwards, or that the far side of the main road is
 * somebody else's problem. Those are things a person knows and a shortest-path
 * algorithm cannot be told.
 *
 * So there are two ways to say it: draw the line the walk should follow, or tap
 * the doors in the order you want them done. They produce the same thing — a
 * list of house ids — and the round is walked in that order until somebody
 * clears it.
 *
 * The drawn line is not the route. It is a description of the shape of the
 * route, and the houses are ordered by where they fall along it: a line up one
 * side of a street and back down the other puts the doors in that order, even
 * though the line itself passes nowhere near most of them.
 */

export interface Point {
  lat: number;
  lng: number;
}

export interface OrderableHouse extends Point {
  id: string;
}

/**
 * Degrees to metres, near enough.
 *
 * A zone is a few streets across, so a fixed local scale is exact enough to
 * order houses along a line and very much cheaper than doing it properly.
 * 39.5° is the middle of the county this was built for.
 */
const KX = Math.cos((39.5 * Math.PI) / 180) * 111_320;
const KY = 110_574;

interface Flat {
  x: number;
  y: number;
}

function flatten(p: Point): Flat {
  return { x: p.lng * KX, y: p.lat * KY };
}

/**
 * Where a point falls on a segment, and how far off it is.
 *
 * `t` is clamped to the segment, so a house past the end of a line projects to
 * the end of it rather than to an imaginary continuation.
 */
export function projectOntoSegment(p: Flat, a: Flat, b: Flat): { t: number; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return { t: 0, distance: Math.hypot(p.x - a.x, p.y - a.y) };
  }
  const raw = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, raw));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return { t, distance: Math.hypot(p.x - cx, p.y - cy) };
}

export interface OrderedAlongLine {
  /** House ids in the order the line passes them. */
  ordered: string[];
  /**
   * Houses further from the line than the caller allowed.
   *
   * Returned rather than dropped or silently appended: a person who drew a line
   * down one street and left forty doors out has either changed their mind
   * about those doors or missed a street, and only they know which.
   */
  offRoute: string[];
  /** How far the furthest kept house was from the line, in metres. */
  furthestKeptMetres: number;
}

/** How far from the drawn line a door can be and still count as on it. */
export const DEFAULT_SNAP_METRES = 120;

/**
 * Order houses by where they fall along a drawn line.
 *
 * Each house is projected onto the nearest point of the line and sorted by how
 * far along the line that point is. Ties — two houses opposite each other —
 * keep the order they came in, which for a list read off the map is stable and
 * arbitrary rather than random.
 */
export function orderAlongLine(
  houses: readonly OrderableHouse[],
  line: readonly Point[],
  snapMetres = DEFAULT_SNAP_METRES
): OrderedAlongLine {
  if (line.length < 2 || houses.length === 0) {
    return { ordered: [], offRoute: houses.map((h) => h.id), furthestKeptMetres: 0 };
  }

  const path = line.map(flatten);
  // Distance along the line at the start of each segment.
  const starts: number[] = [0];
  for (let i = 1; i < path.length; i += 1) {
    starts.push(starts[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  }

  const placed: { id: string; along: number; away: number; index: number }[] = [];
  const offRoute: string[] = [];

  houses.forEach((house, index) => {
    const p = flatten(house);
    let best: { along: number; away: number } | null = null;
    for (let i = 0; i < path.length - 1; i += 1) {
      const { t, distance } = projectOntoSegment(p, path[i], path[i + 1]);
      if (best && distance >= best.away) continue;
      const segmentLength = starts[i + 1] - starts[i];
      best = { along: starts[i] + t * segmentLength, away: distance };
    }
    if (!best || best.away > snapMetres) {
      offRoute.push(house.id);
      return;
    }
    placed.push({ id: house.id, along: best.along, away: best.away, index });
  });

  placed.sort((a, b) => a.along - b.along || a.index - b.index);

  return {
    ordered: placed.map((p) => p.id),
    offRoute,
    furthestKeptMetres: placed.reduce((worst, p) => Math.max(worst, p.away), 0),
  };
}

/**
 * The order a round is actually walked in, given whatever a person has said.
 *
 * A hand-made order can go stale: doors get added after it was drawn, and doors
 * on it get taken off. So it is applied rather than trusted — the ones still on
 * the round keep their given order, and anything added since goes on the end in
 * whatever order the fallback had. Nothing is ever dropped for not being in the
 * list, because dropping a door silently is how a street gets missed.
 */
export function applyOrder(onRound: readonly string[], given: readonly string[]): string[] {
  const round = new Set(onRound);
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const id of given) {
    if (!round.has(id) || seen.has(id)) continue;
    ordered.push(id);
    seen.add(id);
  }
  for (const id of onRound) {
    if (seen.has(id)) continue;
    ordered.push(id);
    seen.add(id);
  }
  return ordered;
}

/** Whether a hand-made order still describes the round, or has drifted from it. */
export function orderIsStale(onRound: readonly string[], given: readonly string[]): boolean {
  if (given.length === 0) return false;
  const round = new Set(onRound);
  const inOrder = new Set(given.filter((id) => round.has(id)));
  return inOrder.size !== round.size;
}

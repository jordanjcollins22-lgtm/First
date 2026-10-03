/**
 * The rule that a work zone sits inside the property line. Nothing is done
 * on somebody else's lot, so an area outside the line is a mistake on the map
 * and a price for ground that is not the client's. Pure, so it is tested
 * without a screen.
 */

type Point = { x: number; y: number };

/** A line that encloses something: three corners or more. Less than that, there is no rule to apply. */
export function hasPropertyLine(line: Point[] | null | undefined): line is Point[] {
  return Array.isArray(line) && line.length >= 3;
}

/** Whether a point is inside the line. A point on the line counts as inside. */
export function insideLine(point: Point, line: Point[]): boolean {
  if (!hasPropertyLine(line)) return true;
  for (let i = 0, j = line.length - 1; i < line.length; j = i++) {
    if (onSegment(point, line[j], line[i])) return true;
  }
  let inside = false;
  for (let i = 0, j = line.length - 1; i < line.length; j = i++) {
    const a = line[i];
    const b = line[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Whether a whole shape is inside the line: every corner inside, and no side
 * of it cutting across the line, which a lot with a notch in it allows even
 * when all four corners are in.
 */
export function shapeInsideLine(shape: Point[], line: Point[]): boolean {
  if (!hasPropertyLine(line)) return true;
  if (!shape.every((point) => insideLine(point, line))) return false;
  for (let i = 0; i < shape.length; i++) {
    const a = shape[i];
    const b = shape[(i + 1) % shape.length];
    for (let k = 0; k < line.length; k++) {
      if (crosses(a, b, line[k], line[(k + 1) % line.length])) return false;
    }
  }
  return true;
}

export type Fitted = { points: Point[]; moved: boolean; shrunk: boolean };

/**
 * A measured area, made to sit inside the line. It keeps its size and is
 * moved the least distance that brings it in, which for an area along a
 * fence is what was meant: the tap was near the line, the bed runs up to it.
 * Only when it cannot fit anywhere near the tap at that size is it drawn
 * smaller; the measurements themselves are never changed, since those are
 * what is priced.
 */
export function fitInsideLine(shape: Point[], anchor: Point, line: Point[]): Fitted {
  if (!hasPropertyLine(line) || shapeInsideLine(shape, line)) return { points: shape, moved: false, shrunk: false };

  let current = shape;
  for (let round = 0; round < 24; round++) {
    const placed = nearestFit(current, anchor, line);
    if (placed) return { points: placed.points, moved: placed.moved, shrunk: round > 0 };
    current = scaleAbout(current, anchor, 0.85);
  }
  // Too small to matter by now, and still not in: drawn as a speck on the tap.
  const speck = scaleAbout(shape, anchor, 0.001);
  return { points: speck, moved: false, shrunk: true };
}

/** The closest placement inside the line with the anchor still under the shape, or null. */
function nearestFit(shape: Point[], anchor: Point, line: Point[]): { points: Point[]; moved: boolean } | null {
  if (shapeInsideLine(shape, line)) return { points: shape, moved: false };
  const xs = shape.map((p) => p.x);
  const ys = shape.map((p) => p.y);
  const reach = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const step = Math.max(1, reach / 40);
  const directions = 32;
  for (let distance = step; distance <= reach; distance += step) {
    for (let d = 0; d < directions; d++) {
      const angle = (d / directions) * Math.PI * 2;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance;
      const moved = shape.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      // Moved, but still over the spot that was tapped: otherwise it is a
      // different area from the one the evaluator pointed at.
      if (insideLine(anchor, moved) && shapeInsideLine(moved, line)) return { points: moved, moved: true };
    }
  }
  return null;
}

function scaleAbout(shape: Point[], centre: Point, factor: number): Point[] {
  return shape.map((p) => ({ x: centre.x + (p.x - centre.x) * factor, y: centre.y + (p.y - centre.y) * factor }));
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function onSegment(p: Point, a: Point, b: Point): boolean {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  if (Math.abs(cross(a, b, p)) / length > 0.5) return false;
  return p.x >= Math.min(a.x, b.x) - 0.5 && p.x <= Math.max(a.x, b.x) + 0.5 && p.y >= Math.min(a.y, b.y) - 0.5 && p.y <= Math.max(a.y, b.y) + 0.5;
}

/** Two sides properly cutting across each other. Touching at an end, or running along the line, is not a crossing. */
function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

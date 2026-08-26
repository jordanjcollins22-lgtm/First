/**
 * Arranging a graph so its shape means something.
 *
 * A force simulation rather than a library: this is sixty lines of arithmetic,
 * and the alternative was a dependency whose whole job is those sixty lines.
 * It runs to a fixed number of steps on the server-rendered data and then
 * hands over to dragging, so nothing animates forever behind somebody trying
 * to read it.
 *
 * Three forces, which is all a readable graph needs. Connected nodes pull
 * together, every node pushes every other apart, and everything drifts gently
 * towards the middle so a disconnected island cannot wander off screen.
 */

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  /** Heavier nodes move less. Weight comes from connection count, so the hub
   * everything hangs off stays put and the leaves arrange themselves round it
   * — rather than the hub being flung about by the sum of its own edges. */
  weight: number;
  /** Set once somebody drags it. A hand-placed node is a decision, and the
   * simulation does not get to overrule it. */
  pinned?: boolean;
}

export interface LayoutEdge {
  sourceId: string;
  targetId: string;
  strength: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  iterations?: number;
  /** How far apart connected nodes want to sit. */
  linkDistance?: number;
  repulsion?: number;
}

/**
 * A starting position for every node.
 *
 * Deterministic, seeded off the id, so the same graph opens the same way twice.
 * A board that reshuffles itself on every visit is one nobody builds a mental
 * map of, and the mental map is the point of a graph over a list.
 */
export function seedPositions(nodes: { id: string }[], width: number, height: number): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const radius = Math.min(width, height) * 0.35;

  nodes.forEach((node, index) => {
    // Golden angle, so nodes land spread out rather than in a spiral arm.
    const angle = index * 2.399963;
    const distance = radius * Math.sqrt((index + 1) / (nodes.length + 1));
    positions.set(node.id, {
      x: width / 2 + Math.cos(angle) * distance,
      y: height / 2 + Math.sin(angle) * distance,
    });
  });

  return positions;
}

/**
 * Runs the simulation and returns where everything settled.
 *
 * Cooling is linear and the step count is fixed: a graph that is still
 * shuffling when somebody reaches for a node is worse than one that is
 * slightly less perfectly arranged.
 */
export function layoutGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions
): LayoutNode[] {
  const { width, height, iterations = 220, linkDistance = 90, repulsion = 6000 } = options;
  if (nodes.length === 0) return [];

  const positioned = nodes.map((n) => ({ ...n }));
  const byId = new Map(positioned.map((n) => [n.id, n]));
  const centreX = width / 2;
  const centreY = height / 2;

  for (let step = 0; step < iterations; step++) {
    // Cooling: big moves early to untangle, small ones late to settle.
    const cooling = 1 - step / iterations;

    for (let i = 0; i < positioned.length; i++) {
      for (let j = i + 1; j < positioned.length; j++) {
        const a = positioned[i];
        const b = positioned[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distanceSq = dx * dx + dy * dy;

        // Two nodes exactly on top of each other have no direction to push in,
        // so they are nudged apart deterministically rather than randomly —
        // random would make the layout different every load.
        if (distanceSq < 0.01) {
          dx = (i - j) * 0.1 || 0.1;
          dy = 0.1;
          distanceSq = dx * dx + dy * dy;
        }

        const distance = Math.sqrt(distanceSq);
        const force = (repulsion / distanceSq) * cooling;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;

        if (!a.pinned) {
          a.x -= fx / a.weight;
          a.y -= fy / a.weight;
        }
        if (!b.pinned) {
          b.x += fx / b.weight;
          b.y += fy / b.weight;
        }
      }
    }

    for (const edge of edges) {
      const a = byId.get(edge.sourceId);
      const b = byId.get(edge.targetId);
      if (!a || !b) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
      // A stronger relationship is a shorter spring: a hard dependency should
      // sit visibly closer than a passing resemblance.
      const rest = linkDistance / Math.max(1, edge.strength * 0.4);
      const force = ((distance - rest) / distance) * 0.08 * cooling * edge.strength;

      if (!a.pinned) {
        a.x += dx * force / a.weight;
        a.y += dy * force / a.weight;
      }
      if (!b.pinned) {
        b.x -= dx * force / b.weight;
        b.y -= dy * force / b.weight;
      }
    }

    // A gentle pull to the middle, so an island with no edges at all cannot
    // be pushed off the canvas by repulsion alone and never come back.
    for (const node of positioned) {
      if (node.pinned) continue;
      node.x += (centreX - node.x) * 0.004 * cooling;
      node.y += (centreY - node.y) * 0.004 * cooling;
    }
  }

  return positioned;
}

/** Keeps a node inside the canvas after a drag, so nothing can be lost off an
 * edge with no way to scroll back to it. */
export function clampToCanvas(x: number, y: number, width: number, height: number, margin = 24) {
  return {
    x: Math.min(Math.max(x, margin), Math.max(margin, width - margin)),
    y: Math.min(Math.max(y, margin), Math.max(margin, height - margin)),
  };
}

/** Node radius from how many things touch it. The printer everything depends
 * on should be the biggest thing on screen without anybody sizing it by hand. */
export function radiusFor(degree: number): number {
  return Math.min(26, 7 + Math.sqrt(degree) * 4);
}

/**
 * Spreads a finished layout across the whole canvas.
 *
 * The simulation settles wherever its constants put it, which on a phone was
 * a knot in one corner with everything else empty. Rather than tuning force
 * numbers per screen size — and getting it wrong on the next screen size —
 * the shape is left alone and the whole thing is scaled to fit afterwards.
 * Relative structure is what the graph is saying; absolute distance is not.
 *
 * Only for layouts nobody has arranged by hand. Rescaling around a node
 * somebody dragged would move it, which is the one thing a hand-placed node
 * must never do.
 */
export function fitToCanvas(
  nodes: LayoutNode[],
  width: number,
  height: number,
  margin = 40
): LayoutNode[] {
  if (nodes.length === 0) return nodes;
  if (nodes.length === 1) return [{ ...nodes[0], x: width / 2, y: height / 2 }];

  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const usableW = Math.max(1, width - margin * 2);
  const usableH = Math.max(1, height - margin * 2);
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  // A graph smaller than its canvas is blown up, but only so far: three nodes
  // flung into three corners reads as three unrelated things.
  const scale = Math.min(2.2, spanX > 0 ? usableW / spanX : 2.2, spanY > 0 ? usableH / spanY : 2.2);

  const offsetX = margin + (usableW - spanX * scale) / 2;
  const offsetY = margin + (usableH - spanY * scale) / 2;

  return nodes.map((node) => ({
    ...node,
    x: offsetX + (node.x - minX) * scale,
    y: offsetY + (node.y - minY) * scale,
  }));
}

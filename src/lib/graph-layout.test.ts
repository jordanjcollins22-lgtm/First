import { describe, expect, it } from "vitest";

import {
  clampToCanvas,
  fitToCanvas,
  layoutGraph,
  radiusFor,
  seedPositions,
  type LayoutNode,
} from "@/lib/graph-layout";

function nodes(count: number, weight = 1): LayoutNode[] {
  return Array.from({ length: count }, (_, i) => ({ id: `n${i}`, x: 0, y: 0, weight }));
}

describe("seedPositions", () => {
  it("opens the same graph the same way twice", () => {
    // A board that reshuffles on every visit is one nobody builds a mental
    // map of, and the mental map is the point of a graph over a list.
    const a = seedPositions(nodes(20), 800, 600);
    const b = seedPositions(nodes(20), 800, 600);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it("puts everything inside the canvas", () => {
    for (const { x, y } of seedPositions(nodes(50), 800, 600).values()) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(800);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(600);
    }
  });

  it("does not stack nodes on one spot", () => {
    const positions = [...seedPositions(nodes(12), 800, 600).values()];
    const distinct = new Set(positions.map((p) => `${Math.round(p.x)}:${Math.round(p.y)}`));
    expect(distinct.size).toBe(positions.length);
  });
});

describe("layoutGraph", () => {
  const seeded = (count: number): LayoutNode[] => {
    const positions = seedPositions(nodes(count), 800, 600);
    return nodes(count).map((n) => ({ ...n, ...positions.get(n.id)! }));
  };

  it("pushes unconnected nodes apart rather than leaving them overlapping", () => {
    const laid = layoutGraph(seeded(6), [], { width: 800, height: 600, iterations: 120 });
    for (let i = 0; i < laid.length; i++) {
      for (let j = i + 1; j < laid.length; j++) {
        const distance = Math.hypot(laid[i].x - laid[j].x, laid[i].y - laid[j].y);
        expect(distance).toBeGreaterThan(20);
      }
    }
  });

  it("pulls connected nodes closer than unconnected ones", () => {
    const start = seeded(3);
    const laid = layoutGraph(start, [{ sourceId: "n0", targetId: "n1", strength: 5 }], {
      width: 800,
      height: 600,
    });
    const linked = Math.hypot(laid[0].x - laid[1].x, laid[0].y - laid[1].y);
    const loose = Math.hypot(laid[0].x - laid[2].x, laid[0].y - laid[2].y);
    expect(linked).toBeLessThan(loose);
  });

  it("leaves a node somebody placed by hand exactly where they put it", () => {
    // A hand-placed node is a decision, and the simulation does not get to
    // overrule it.
    const start = seeded(5).map((n, i) => (i === 0 ? { ...n, x: 123, y: 456, pinned: true } : n));
    const laid = layoutGraph(start, [{ sourceId: "n0", targetId: "n1", strength: 5 }], {
      width: 800,
      height: 600,
    });
    expect(laid[0].x).toBe(123);
    expect(laid[0].y).toBe(456);
  });

  it("moves a heavy node less than a light one", () => {
    // The hub everything hangs off should stay put while the leaves arrange
    // themselves around it.
    const heavy = layoutGraph(
      seeded(2).map((n, i) => ({ ...n, weight: i === 0 ? 20 : 1 })),
      [{ sourceId: "n0", targetId: "n1", strength: 5 }],
      { width: 800, height: 600 }
    );
    const start = seeded(2);
    const movedHeavy = Math.hypot(heavy[0].x - start[0].x, heavy[0].y - start[0].y);
    const movedLight = Math.hypot(heavy[1].x - start[1].x, heavy[1].y - start[1].y);
    expect(movedHeavy).toBeLessThan(movedLight);
  });

  it("settles rather than flinging anything to infinity", () => {
    const laid = layoutGraph(seeded(30), [], { width: 800, height: 600 });
    for (const node of laid) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(Math.abs(node.x)).toBeLessThan(20000);
    }
  });

  it("separates two nodes sitting exactly on top of each other", () => {
    // No direction to push in, so it has to be nudged — and deterministically,
    // or the layout differs on every load.
    const stacked: LayoutNode[] = [
      { id: "a", x: 400, y: 300, weight: 1 },
      { id: "b", x: 400, y: 300, weight: 1 },
    ];
    const laid = layoutGraph(stacked, [], { width: 800, height: 600 });
    expect(Math.hypot(laid[0].x - laid[1].x, laid[0].y - laid[1].y)).toBeGreaterThan(5);
  });

  it("has nothing to do with an empty graph", () => {
    expect(layoutGraph([], [], { width: 800, height: 600 })).toEqual([]);
  });
});

describe("clampToCanvas", () => {
  it("keeps a dragged node from being lost off an edge", () => {
    expect(clampToCanvas(-500, 9000, 800, 600)).toEqual({ x: 24, y: 576 });
  });

  it("leaves a node that is already inside alone", () => {
    expect(clampToCanvas(400, 300, 800, 600)).toEqual({ x: 400, y: 300 });
  });
});

describe("radiusFor", () => {
  it("grows with connections, so the hub is the biggest thing on screen", () => {
    expect(radiusFor(0)).toBeLessThan(radiusFor(4));
    expect(radiusFor(4)).toBeLessThan(radiusFor(25));
  });

  it("stops growing, so one hub cannot swallow the graph", () => {
    expect(radiusFor(10000)).toBeLessThanOrEqual(26);
  });
});

describe("fitToCanvas", () => {
  const box = (nodes: { x: number; y: number }[]) => ({
    minX: Math.min(...nodes.map((n) => n.x)),
    maxX: Math.max(...nodes.map((n) => n.x)),
    minY: Math.min(...nodes.map((n) => n.y)),
    maxY: Math.max(...nodes.map((n) => n.y)),
  });

  it("spreads a knotted layout across the canvas", () => {
    const knot = [
      { id: "a", x: 200, y: 200, weight: 1 },
      { id: "b", x: 210, y: 205, weight: 1 },
      { id: "c", x: 195, y: 215, weight: 1 },
    ];
    const fitted = fitToCanvas(knot, 360, 500);
    const bounds = box(fitted);
    // It fills more of the canvas than it did, and stays inside it.
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(15);
    expect(bounds.minX).toBeGreaterThanOrEqual(0);
    expect(bounds.maxX).toBeLessThanOrEqual(360);
    expect(bounds.minY).toBeGreaterThanOrEqual(0);
    expect(bounds.maxY).toBeLessThanOrEqual(500);
  });

  it("keeps the shape — relative order survives the rescale", () => {
    const nodes = [
      { id: "left", x: 0, y: 50, weight: 1 },
      { id: "middle", x: 50, y: 50, weight: 1 },
      { id: "right", x: 300, y: 50, weight: 1 },
    ];
    const fitted = fitToCanvas(nodes, 400, 400);
    expect(fitted[0].x).toBeLessThan(fitted[1].x);
    expect(fitted[1].x).toBeLessThan(fitted[2].x);
    // Middle stays nearer the left, in proportion.
    const total = fitted[2].x - fitted[0].x;
    expect((fitted[1].x - fitted[0].x) / total).toBeCloseTo(50 / 300, 5);
  });

  it("centres a single node rather than dividing by a zero span", () => {
    expect(fitToCanvas([{ id: "only", x: 5, y: 5, weight: 1 }], 300, 200)).toEqual([
      { id: "only", x: 150, y: 100, weight: 1 },
    ]);
  });

  it("leaves an empty layout alone", () => {
    expect(fitToCanvas([], 300, 200)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import {
  clampToCanvas,
  fitToCanvas,
  layeredLayout,
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

describe("layeredLayout", () => {
  const node = (id: string) => ({ id, x: 0, y: 0, weight: 1 });
  const link = (sourceId: string, targetId: string) => ({ sourceId, targetId, strength: 3 });

  it("puts the ideas on top and what they need underneath", () => {
    const laid = layeredLayout(
      [node("flyers"), node("card"), node("toner")],
      [link("flyers", "card"), link("flyers", "toner")],
      { width: 400, height: 400, roots: ["flyers"] }
    );

    const flyers = laid.find((n) => n.id === "flyers")!;
    const card = laid.find((n) => n.id === "card")!;
    const toner = laid.find((n) => n.id === "toner")!;
    expect(card.y).toBeGreaterThan(flyers.y);
    expect(toner.y).toBeGreaterThan(flyers.y);
    // Same row as each other.
    expect(card.y).toBe(toner.y);
  });

  it("goes another row down for what those need", () => {
    const laid = layeredLayout(
      [node("hangers"), node("run"), node("card")],
      [link("hangers", "run"), link("run", "card")],
      { width: 400, height: 400, roots: ["hangers"] }
    );

    const rows = ["hangers", "run", "card"].map((id) => laid.find((n) => n.id === id)!.y);
    expect(rows[0]).toBeLessThan(rows[1]);
    expect(rows[1]).toBeLessThan(rows[2]);
  });

  it("puts a shared material at the shallower of its depths", () => {
    // Cardstock is one hop from the flyers and two from the door hangers.
    // It belongs next to the thing that names it directly.
    const laid = layeredLayout(
      [node("flyers"), node("hangers"), node("run"), node("card")],
      [link("flyers", "card"), link("hangers", "run"), link("run", "card")],
      { width: 400, height: 400, roots: ["flyers", "hangers"] }
    );

    const run = laid.find((n) => n.id === "run")!;
    const card = laid.find((n) => n.id === "card")!;
    expect(card.y).toBe(run.y);
  });

  it("sits a material under the idea that needs it rather than across the page", () => {
    const laid = layeredLayout(
      [node("a-idea"), node("z-idea"), node("a-need"), node("z-need")],
      [link("a-idea", "a-need"), link("z-idea", "z-need")],
      { width: 400, height: 400, roots: ["a-idea", "z-idea"] }
    );

    const aIdea = laid.find((n) => n.id === "a-idea")!;
    const zIdea = laid.find((n) => n.id === "z-idea")!;
    const aNeed = laid.find((n) => n.id === "a-need")!;
    const zNeed = laid.find((n) => n.id === "z-need")!;

    // Whatever order the top row lands in, each need is on the same side as
    // its own idea — the lines do not cross.
    expect(aIdea.x < zIdea.x).toBe(aNeed.x < zNeed.x);
  });

  it("gives whatever nothing reaches a row of its own at the bottom", () => {
    const laid = layeredLayout(
      [node("flyers"), node("card"), node("orphan")],
      [link("flyers", "card")],
      { width: 400, height: 400, roots: ["flyers"] }
    );

    const card = laid.find((n) => n.id === "card")!;
    const orphan = laid.find((n) => n.id === "orphan")!;
    expect(orphan.y).toBeGreaterThan(card.y);
  });

  it("stays inside the canvas while the rows fit", () => {
    const laid = layeredLayout(
      [node("a"), node("b"), node("c"), node("d")],
      [link("a", "b"), link("a", "c"), link("b", "d")],
      { width: 360, height: 500, roots: ["a"] }
    );

    for (const n of laid) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(360);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(500);
    }
  });

  it("centres the block rather than stretching two rows to the edges", () => {
    // Two rows on a tall phone screen used to sit at the very top and the
    // very bottom with a canyon of nothing between them.
    const laid = layeredLayout([node("a"), node("b")], [link("a", "b")], {
      width: 360,
      height: 600,
      roots: ["a"],
    });

    const a = laid.find((n) => n.id === "a")!;
    const b = laid.find((n) => n.id === "b")!;
    expect(b.y - a.y).toBeLessThanOrEqual(150);
    // Centred: the gap above the first row matches the gap below the last.
    expect(a.y).toBeCloseTo(600 - b.y, 5);
  });

  it("lets a crowded row run wider than the canvas rather than stacking labels", () => {
    // Seven things on a 360px phone is fifty pixels apart. Names do not fit
    // in fifty pixels, and an unreadable row that fits is worse than a
    // readable one you pan to.
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const laid = layeredLayout(
      ids.map(node),
      ids.slice(1).map((id) => link("a", id)),
      { width: 360, height: 600, roots: ["a"] }
    );

    const row = laid.filter((n) => n.id !== "a").sort((x, y) => x.x - y.x);
    for (let i = 1; i < row.length; i++) {
      expect(row[i].x - row[i - 1].x).toBeGreaterThanOrEqual(92);
    }
    // Still centred on the canvas, so panning either way reaches the ends.
    expect(row[0].x + row[row.length - 1].x).toBeCloseTo(360, 5);
  });

  it("alternates heights in a crowded row so labels have somewhere to go", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const laid = layeredLayout(
      ids.map(node),
      ids.slice(1).map((id) => link("a", id)),
      { width: 360, height: 600, roots: ["a"] }
    );

    const row = laid.filter((n) => n.id !== "a").sort((x, y) => x.x - y.x);
    const heights = new Set(row.map((n) => n.y));
    expect(heights.size).toBe(2);
  });

  it("does not zig-zag a row small enough to read straight", () => {
    const laid = layeredLayout(
      [node("a"), node("b"), node("c")],
      [link("a", "b"), link("a", "c")],
      { width: 360, height: 600, roots: ["a"] }
    );
    const row = laid.filter((n) => n.id !== "a");
    expect(new Set(row.map((n) => n.y)).size).toBe(1);
  });

  it("centres a single node instead of pinning it to a corner", () => {
    const [only] = layeredLayout([node("solo")], [], { width: 300, height: 200, roots: ["solo"] });
    expect(only).toMatchObject({ x: 150, y: 100 });
  });

  it("survives a cycle", () => {
    expect(() =>
      layeredLayout([node("a"), node("b")], [link("a", "b"), link("b", "a")], {
        width: 300,
        height: 300,
        roots: ["a"],
      })
    ).not.toThrow();
  });

  it("opens the same way twice", () => {
    const build = () =>
      layeredLayout(
        [node("flyers"), node("hangers"), node("card"), node("toner")],
        [link("flyers", "card"), link("hangers", "card"), link("flyers", "toner")],
        { width: 400, height: 400, roots: ["flyers", "hangers"] }
      );
    expect(build()).toEqual(build());
  });

  it("places everything somewhere when nothing is a root", () => {
    const laid = layeredLayout([node("a"), node("b")], [link("a", "b")], {
      width: 300,
      height: 300,
      roots: [],
    });
    expect(laid).toHaveLength(2);
    expect(laid.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
  });

  it("leaves an empty graph alone", () => {
    expect(layeredLayout([], [], { width: 300, height: 300, roots: [] })).toEqual([]);
  });
});

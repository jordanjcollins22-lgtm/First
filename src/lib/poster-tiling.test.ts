import { describe, expect, it } from "vitest";

import { assemblyOrder, BLEED, LETTER, planTiles, SHEET_MARGIN, tileLabel } from "@/lib/poster-tiling";

const FRAME = { width: 20, height: 30 };

describe("cutting a twenty by thirty poster into letter sheets", () => {
  const plan = planTiles(FRAME);

  it("turns it the way that needs fewest sheets", () => {
    // Nine sheets portrait against eight landscape.
    expect(plan.orientation).toBe("landscape");
    expect(plan.tiles).toHaveLength(8);
    expect(plan.columns).toBe(2);
    expect(plan.rows).toBe(4);
  });

  it("gives every sheet the same rectangle of poster", () => {
    expect(plan.tile.width).toBeCloseTo(10, 6);
    expect(plan.tile.height).toBeCloseTo(7.5, 6);
  });

  it("covers the whole poster and no more", () => {
    expect(plan.tile.width * plan.columns).toBeCloseTo(FRAME.width, 6);
    expect(plan.tile.height * plan.rows).toBeCloseTo(FRAME.height, 6);
  });

  it("keeps every tile inside what a printer can reach", () => {
    const across = plan.tile.width + 2 * BLEED + 2 * SHEET_MARGIN;
    const down = plan.tile.height + 2 * BLEED + 2 * SHEET_MARGIN;
    expect(across).toBeLessThanOrEqual(plan.sheet.width + 1e-9);
    expect(down).toBeLessThanOrEqual(plan.sheet.height + 1e-9);
  });

  it("lays the tiles out left to right, top to bottom", () => {
    expect(plan.tiles[0]).toMatchObject({ row: 1, column: 1 });
    expect(plan.tiles[1]).toMatchObject({ row: 1, column: 2 });
    expect(plan.tiles[2]).toMatchObject({ row: 2, column: 1 });
  });

  it("puts each tile where it belongs on the poster", () => {
    const bottomRight = plan.tiles.at(-1)!;
    expect(bottomRight.source.x).toBeCloseTo(10, 6);
    expect(bottomRight.source.y).toBeCloseTo(22.5, 6);
  });

  it("leaves no gap and no overlap between neighbours", () => {
    for (const tile of plan.tiles) {
      const right = plan.tiles.find((t) => t.row === tile.row && t.column === tile.column + 1);
      if (right) expect(right.source.x).toBeCloseTo(tile.source.x + tile.source.width, 6);
      const below = plan.tiles.find((t) => t.column === tile.column && t.row === tile.row + 1);
      if (below) expect(below.source.y).toBeCloseTo(tile.source.y + tile.source.height, 6);
    }
  });

  it("centres the artwork on the sheet, so a stack lines up", () => {
    expect(plan.offset.x).toBeCloseTo((plan.sheet.width - plan.tile.width) / 2, 6);
    expect(plan.offset.y).toBeCloseTo((plan.sheet.height - plan.tile.height) / 2, 6);
  });
});

describe("where the bleed goes", () => {
  const plan = planTiles(FRAME);

  it("puts none of it past the poster's own edges", () => {
    // A mark out there is a mark somebody cuts to, and there is nothing to
    // print past the edge of the poster anyway.
    const topLeft = plan.tiles[0];
    expect(topLeft.bleed.top).toBe(0);
    expect(topLeft.bleed.left).toBe(0);
    expect(topLeft.bleed.right).toBe(BLEED);
    expect(topLeft.bleed.bottom).toBe(BLEED);
  });

  it("puts it on every edge that meets another sheet", () => {
    const middle = plan.tiles.find((t) => t.row === 2 && t.column === 1)!;
    expect(middle.bleed.top).toBe(BLEED);
    expect(middle.bleed.bottom).toBe(BLEED);
    expect(middle.bleed.right).toBe(BLEED);
    expect(middle.bleed.left).toBe(0);
  });

  it("gives the bottom right corner no bleed on the outside", () => {
    const corner = plan.tiles.at(-1)!;
    expect(corner.bleed.right).toBe(0);
    expect(corner.bleed.bottom).toBe(0);
  });
});

describe("posters of other sizes", () => {
  it("puts a small one on a single sheet and keeps it that way up", () => {
    const plan = planTiles({ width: 7, height: 9 });
    expect(plan.tiles).toHaveLength(1);
    expect(plan.orientation).toBe("portrait");
  });

  it("handles a wide one", () => {
    const plan = planTiles({ width: 36, height: 24 });
    expect(plan.tile.width * plan.columns).toBeCloseTo(36, 6);
    expect(plan.tile.height * plan.rows).toBeCloseTo(24, 6);
  });

  it("handles a very tall thin one in a single column", () => {
    // Ten inches fits one landscape sheet across, so there is no vertical
    // seam at all, which on a five foot banner is the seam that matters.
    const plan = planTiles({ width: 10, height: 60 });
    expect(plan.columns).toBe(1);
    expect(plan.tiles).toHaveLength(plan.rows);
  });

  it("covers the poster exactly whatever the size", () => {
    for (const poster of [
      { width: 20, height: 30 },
      { width: 24, height: 36 },
      { width: 18, height: 24 },
      { width: 11, height: 17 },
      { width: 40, height: 60 },
    ]) {
      const plan = planTiles(poster);
      expect(plan.tile.width * plan.columns).toBeCloseTo(poster.width, 6);
      expect(plan.tile.height * plan.rows).toBeCloseTo(poster.height, 6);
      expect(plan.tiles).toHaveLength(plan.rows * plan.columns);
    }
  });

  it("never asks a sheet to carry more than it can print", () => {
    for (const poster of [
      { width: 20, height: 30 },
      { width: 36, height: 24 },
      { width: 8, height: 10 },
      { width: 60, height: 40 },
    ]) {
      const plan = planTiles(poster);
      expect(plan.tile.width + 2 * BLEED + 2 * SHEET_MARGIN).toBeLessThanOrEqual(plan.sheet.width + 1e-9);
      expect(plan.tile.height + 2 * BLEED + 2 * SHEET_MARGIN).toBeLessThanOrEqual(plan.sheet.height + 1e-9);
    }
  });

  it("does not add a sheet to floating point", () => {
    // 30 / 7.65 is 3.92 and change, and an unrounded ceiling of something
    // that should be exactly 4 is a ninth sheet with a sliver on it.
    const plan = planTiles({ width: LETTER.height - 2 * SHEET_MARGIN - 2 * BLEED, height: 30 });
    expect(plan.columns).toBe(1);
  });
});

describe("what each sheet says about itself", () => {
  const plan = planTiles(FRAME);

  it("names its place in the grid", () => {
    expect(tileLabel(plan.tiles[0], plan)).toBe("Row 1, column 1 of 4 by 2");
  });

  it("tells somebody how to put it together", () => {
    const order = assemblyOrder(plan);
    expect(order).toContain("8 sheets");
    expect(order).toContain("tape");
  });

  it("does not give instructions for taping one sheet to itself", () => {
    expect(assemblyOrder(planTiles({ width: 7, height: 9 }))).toContain("One sheet");
  });
});

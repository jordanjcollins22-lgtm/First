import { describe, expect, it } from "vitest";

import { collide, packSheets, type Packable, type Placement } from "@/lib/sheet-packing";

const SHEET = { width: 10.4, height: 7.9 };
const GUTTER = 0.3;

interface Named extends Packable {
  id: string;
}

function piece(id: string, width: number, height: number): Named {
  return { id, width, height };
}

/** Every placement across every sheet, with the sheet it landed on. */
function all(sheets: { placements: Placement<Named>[] }[]) {
  return sheets.flatMap((s, i) => s.placements.map((p) => ({ ...p, sheet: i })));
}

describe("packing cutouts onto sheets", () => {
  it("puts everything somewhere", () => {
    const items = [piece("a", 10, 1.3), piece("b", 2.3, 1.3), piece("c", 5, 1.2), piece("d", 7.2, 7.2)];
    const placed = all(packSheets(items, SHEET, GUTTER));
    expect(placed.map((p) => p.item.id).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("never puts the same piece down twice", () => {
    const items = Array.from({ length: 12 }, (_, i) => piece(`p${i}`, 4, 1));
    const placed = all(packSheets(items, SHEET, GUTTER));
    expect(new Set(placed.map((p) => p.item.id)).size).toBe(12);
  });

  it("leaves a blade's width between everything on a sheet", () => {
    // The whole point. Two shapes sharing an edge cannot be cut apart without
    // cutting one of them.
    const items = [
      piece("wide", 10.1, 1.2),
      piece("narrow", 2.3, 1.2),
      piece("mid", 5, 1.7),
      piece("tall", 7.2, 7.2),
      piece("short", 2.6, 0.9),
      piece("strip", 10.2, 0.7),
    ];
    for (const sheet of packSheets(items, SHEET, GUTTER)) {
      for (let i = 0; i < sheet.placements.length; i += 1) {
        for (let j = i + 1; j < sheet.placements.length; j += 1) {
          const a = sheet.placements[i];
          const b = sheet.placements[j];
          expect(collide(a, b, GUTTER), `${a.item.id} and ${b.item.id}`).toBe(false);
        }
      }
    }
  });

  it("keeps everything on the paper", () => {
    const items = [piece("a", 10.2, 1.3), piece("b", 7.2, 7.2), piece("c", 2.3, 1.3), piece("d", 5, 1.2)];
    for (const sheet of packSheets(items, SHEET, GUTTER)) {
      for (const p of sheet.placements) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-9);
        expect(p.y).toBeGreaterThanOrEqual(-1e-9);
        expect(p.x + p.item.width).toBeLessThanOrEqual(SHEET.width + 1e-9);
        expect(p.y + p.item.height).toBeLessThanOrEqual(SHEET.height + 1e-9);
      }
    }
  });

  it("stacks wide strips up the page rather than taking a sheet each", () => {
    // Six strips at 1.2in tall plus gutters is 8.7in, so five fit and the
    // sixth starts a second sheet. One per sheet would be six.
    const items = Array.from({ length: 6 }, (_, i) => piece(`s${i}`, 10.2, 1.2));
    const sheets = packSheets(items, SHEET, GUTTER);
    expect(sheets.length).toBeLessThanOrEqual(2);
    expect(sheets[0].placements.length).toBeGreaterThanOrEqual(5);
  });

  it("gets several narrow pieces onto one sheet", () => {
    // Whether they end up side by side or stacked is the packer's business —
    // both are one straight cut apart. What matters is that three small
    // phrases do not become three sheets.
    const items = [piece("a", 3, 1), piece("b", 3, 1), piece("c", 3, 1)];
    expect(packSheets(items, SHEET, GUTTER)).toHaveLength(1);
  });

  it("fills the space beside something tall", () => {
    // A seven-inch square leaves a three-inch column down the side, and that
    // column is where the short narrow phrases belong.
    const items = [piece("qr", 7.2, 7.2), piece("a", 2.6, 0.9), piece("b", 2.3, 1.3)];
    const sheets = packSheets(items, SHEET, GUTTER);
    expect(sheets).toHaveLength(1);
  });

  it("uses fewer sheets than one each, on the real sign", () => {
    const sign = [
      piece("name-1", 2.27, 1.28),
      piece("name-2", 10.1, 1.28),
      piece("working-1", 6.66, 1.73),
      piece("working-2", 9.96, 1.73),
      piece("neighborhood-1", 4.96, 1.16),
      piece("neighborhood-2", 10.11, 1.16),
      piece("get-a", 2.61, 0.86),
      piece("offer-1", 9.76, 1.13),
      piece("offer-2", 10.11, 1.67),
      piece("scan-1", 10.2, 0.98),
      piece("scan-2", 5.11, 0.98),
      piece("qr", 7.2, 7.2),
      piece("fallback-1", 10.08, 0.7),
      piece("fallback-2", 2.77, 0.7),
    ];
    const sheets = packSheets(sign, SHEET, GUTTER);
    expect(all(sheets)).toHaveLength(14);
    // Fourteen sheets before. Area alone says at least two.
    expect(sheets.length).toBeLessThanOrEqual(4);
    expect(sheets.length).toBeGreaterThanOrEqual(2);
  });

  it("gives the same answer every time, so a reprint matches", () => {
    const items = [piece("a", 4, 1.2), piece("b", 4, 1.2), piece("c", 9, 2), piece("d", 3, 0.8)];
    const once = JSON.stringify(packSheets(items, SHEET, GUTTER));
    const twice = JSON.stringify(packSheets(items, SHEET, GUTTER));
    expect(once).toBe(twice);
  });

  it("still prints a piece bigger than the paper rather than losing the word", () => {
    const sheets = packSheets([piece("huge", 20, 20)], SHEET, GUTTER);
    expect(all(sheets).map((p) => p.item.id)).toEqual(["huge"]);
  });

  it("has nothing to do with nothing", () => {
    expect(packSheets([], SHEET, GUTTER)).toEqual([]);
  });
});

describe("knowing when two cutouts cannot be separated", () => {
  const a: Placement<Named> = { item: piece("a", 2, 1), x: 0, y: 0 };

  it("calls touching shapes a collision, because a blade needs room", () => {
    expect(collide(a, { item: piece("b", 2, 1), x: 2, y: 0 }, GUTTER)).toBe(true);
  });

  it("is happy once there is a lane between them", () => {
    expect(collide(a, { item: piece("b", 2, 1), x: 2 + GUTTER, y: 0 }, GUTTER)).toBe(false);
    expect(collide(a, { item: piece("b", 2, 1), x: 0, y: 1 + GUTTER }, GUTTER)).toBe(false);
  });

  it("does not mind shapes that are nowhere near each other", () => {
    expect(collide(a, { item: piece("b", 2, 1), x: 8, y: 5 }, GUTTER)).toBe(false);
  });
});

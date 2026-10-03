import { describe, expect, it } from "vitest";

import { SHIRT_COLORS, SHIRT_DESIGNS, groupShirts, readShirtLine, shirtArt, shirtColor, totalShirts, type ShirtLine } from "@/lib/shirts";
import { existsSync } from "node:fs";
import { join } from "node:path";

const line = (over: Partial<ShirtLine>): ShirtLine => ({ design: "classic", style: "tee", color: "forest-green", size: "L", quantity: 1, name: null, ...over });

describe("company shirts", () => {
  it("has a print file for every side of every design in every colour it comes in", () => {
    for (const d of SHIRT_DESIGNS) {
      for (const key of d.colors) {
        const color = shirtColor(key)!;
        expect(color).not.toBeNull();
        for (const print of [d.front, d.back]) {
          if (!print) continue;
          for (const size of ["print", "preview"] as const) {
            expect(existsSync(join(process.cwd(), "public", shirtArt(print, color, size)))).toBe(true);
          }
        }
      }
    }
  });

  it("puts the colour logo on black, and the white one on green", () => {
    const chest = SHIRT_DESIGNS[0].front!;
    expect(shirtArt(chest, shirtColor("black")!, "print")).toBe("/shirts/print/chest-color.png");
    expect(shirtArt(chest, shirtColor("forest-green")!, "print")).toBe("/shirts/print/chest-white.png");
    expect(shirtArt(SHIRT_DESIGNS[0].back!, shirtColor("black")!, "print")).toBe("/shirts/print/classic-back-dark.png");
    expect(SHIRT_COLORS.every((c) => /^#[0-9a-f]{6}$/.test(c.hex))).toBe(true);
  });

  it("only takes lines for shirts we make", () => {
    expect(readShirtLine({ design: "classic", style: "tee", color: "black", size: "XL", quantity: 3, name: " Jace " })).toEqual(line({ color: "black", size: "XL", quantity: 3, name: "Jace" }));
    expect(readShirtLine({ design: "classic", style: "tee", color: "safety-orange", size: "L", quantity: 1 })).toBeNull();
    expect(readShirtLine({ design: "classic", style: "tank", color: "black", size: "L", quantity: 1 })).toBeNull();
    expect(readShirtLine({ design: "classic", style: "tee", color: "black", size: "XXS", quantity: 1 })).toBeNull();
    expect(readShirtLine({ design: "classic", style: "tee", color: "black", size: "L", quantity: 0 })).toBeNull();
  });

  it("groups the order by design, style and colour, with sizes counted", () => {
    const lines = [
      line({ size: "L", quantity: 2, name: "Jace" }),
      line({ size: "XL", quantity: 1 }),
      line({ size: "L", quantity: 1 }),
      line({ design: "crew", color: "safety-green", size: "M", quantity: 4 }),
    ];
    const groups = groupShirts(lines);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ design: "classic", color: "forest-green", sizes: { L: 3, XL: 1 }, total: 4, names: [{ size: "L", name: "Jace" }] });
    expect(groups[1]).toMatchObject({ design: "crew", sizes: { M: 4 }, total: 4 });
    expect(totalShirts(lines)).toBe(8);
  });
});

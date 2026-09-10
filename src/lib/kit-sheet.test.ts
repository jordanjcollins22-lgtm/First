import { describe, expect, it } from "vitest";

import {
  columns,
  contentDisposition,
  countLabel,
  fileNameFor,
  kitNumbers,
  kitQuantity,
  layoutFor,
  MARGIN,
  MAX_ROW_HEIGHT,
  MIN_ROW_HEIGHT,
  PAGE_WIDTH,
  paginate,
  TARGET_PAGES,
  sheetsFor,
  toolsInKit,
  toolsInNoKit,
  whereLabel,
  type KitTool,
} from "@/lib/kit-sheet";

function tool(name: string, over: Partial<KitTool> = {}): KitTool {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    description: null,
    imagePath: null,
    howToUrl: null,
    storageLocation: null,
    quantity: null,
    kits: [],
    kitQuantities: {},
    ...over,
  };
}

const SHOP = [
  tool("Hedge trimmer", { kits: [1, 2], storageLocation: "Shelf B" }),
  tool("Edger", { kits: [1] }),
  tool("Blower", { kits: [2] }),
  tool("Auger", { kits: [] }),
  tool("Rake", { kits: [3] }),
];

describe("which kits exist", () => {
  it("finds them from the tools, since nothing else lists them", () => {
    // A kit comes into being the moment somebody ticks it on a tool, so the
    // only true list is the one the tools themselves give.
    expect(kitNumbers(SHOP)).toEqual([1, 2, 3]);
  });

  it("counts a kit once however many tools claim it", () => {
    expect(kitNumbers([tool("a", { kits: [1] }), tool("b", { kits: [1] })])).toEqual([1]);
  });

  it("puts them in order rather than in the order it met them", () => {
    expect(kitNumbers([tool("a", { kits: [9, 2] }), tool("b", { kits: [5] })])).toEqual([2, 5, 9]);
  });

  it("finds none when nothing is in a kit", () => {
    expect(kitNumbers([tool("a"), tool("b")])).toEqual([]);
  });
});

describe("what goes on one kit's sheet", () => {
  it("takes every tool that claims the kit", () => {
    expect(toolsInKit(SHOP, 1).map((t) => t.name)).toEqual(["Edger", "Hedge trimmer"]);
  });

  it("lets one tool belong to two kits, because one does", () => {
    expect(toolsInKit(SHOP, 2).map((t) => t.name)).toContain("Hedge trimmer");
    expect(toolsInKit(SHOP, 1).map((t) => t.name)).toContain("Hedge trimmer");
  });

  it("lists them by name, so the sheet reads the same every print", () => {
    const jumbled = [tool("Zip", { kits: [1] }), tool("Auger", { kits: [1] }), tool("Mower", { kits: [1] })];
    expect(toolsInKit(jumbled, 1).map((t) => t.name)).toEqual(["Auger", "Mower", "Zip"]);
  });

  it("finds the ones in no kit at all, which is usually an oversight", () => {
    expect(toolsInNoKit(SHOP).map((t) => t.name)).toEqual(["Auger"]);
  });
});

describe("choosing what to print", () => {
  it("prints every kit when nothing is asked for", () => {
    expect(sheetsFor(SHOP, null).map((s) => s.title)).toEqual(["Kit 1", "Kit 2", "Kit 3"]);
  });

  it("gives each kit its own sheet rather than running them together", () => {
    // A checklist that carries on under another kit's heading is one somebody
    // ticks against the wrong van.
    const sheets = sheetsFor(SHOP, "all");
    expect(sheets).toHaveLength(3);
    for (const sheet of sheets) expect(sheet.kit).not.toBeNull();
  });

  it("prints just the one asked for", () => {
    const sheets = sheetsFor(SHOP, "2");
    expect(sheets).toHaveLength(1);
    expect(sheets[0].title).toBe("Kit 2");
    expect(sheets[0].tools.map((t) => t.name)).toEqual(["Blower", "Hedge trimmer"]);
  });

  it("prints the whole shop when asked for the inventory", () => {
    const sheets = sheetsFor(SHOP, "inventory");
    expect(sheets).toHaveLength(1);
    expect(sheets[0].tools).toHaveLength(SHOP.length);
    expect(sheets[0].kit).toBeNull();
  });

  it("prints the strays on their own, so they can be put somewhere", () => {
    const sheets = sheetsFor(SHOP, "unassigned");
    expect(sheets[0].title).toBe("Not in any kit");
    expect(sheets[0].tools.map((t) => t.name)).toEqual(["Auger"]);
  });

  it("falls back to every kit rather than an empty file", () => {
    for (const nonsense of ["", "  ", "kit two", "-3", "0", "1.5"]) {
      expect(sheetsFor(SHOP, nonsense).length, nonsense).toBe(3);
    }
  });

  it("gives an empty answer for a kit nobody has made", () => {
    const sheets = sheetsFor(SHOP, "9");
    expect(sheets[0].title).toBe("Kit 9");
    expect(sheets[0].tools).toEqual([]);
  });
});

describe("how big the rows can be", () => {
  it("fits a small kit on one page with room to spare per tool", () => {
    const layout = layoutFor(2);
    expect(layout.pages).toBe(1);
    expect(layout.rowHeight).toBeGreaterThan(MIN_ROW_HEIGHT * 2);
  });

  it("gives a fifteen-tool kit two pages rather than cramming or sprawling", () => {
    // The real Kit 1. One sheet, both sides, which is what was asked for.
    const layout = layoutFor(15);
    expect(layout.pages).toBe(2);
    expect(layout.rowsPerPage).toBe(8);
  });

  it("makes the rows on a small kit much taller than on a big one", () => {
    // A kit of two used to get the same postage stamp as a kit of fifteen, on
    // a sheet that was three quarters empty.
    expect(layoutFor(3).rowHeight).toBeGreaterThan(layoutFor(15).rowHeight * 2);
  });

  it("never draws a row too short to see the photograph in", () => {
    for (const count of [1, 2, 5, 15, 16, 30, 48, 200]) {
      expect(layoutFor(count).rowHeight, `${count} tools`).toBeGreaterThanOrEqual(MIN_ROW_HEIGHT);
    }
  });

  it("caps the row, so two tools are not two enormous pictures", () => {
    expect(layoutFor(1).rowHeight).toBeLessThanOrEqual(MAX_ROW_HEIGHT);
  });

  it("keeps a page's rows inside the page", () => {
    for (const count of [1, 2, 4, 8, 15, 40]) {
      const layout = layoutFor(count);
      const used = layout.rowsPerPage * (layout.rowHeight + 6) - 6;
      expect(used, `${count} tools`).toBeLessThanOrEqual(792 - 2 * MARGIN - 62 - 22 + 1e-6);
    }
  });

  it("takes more than two pages only when a kit is too big for two", () => {
    expect(layoutFor(15).pages).toBeLessThanOrEqual(TARGET_PAGES);
    // Forty tools cannot be legible over two sides, so it spills rather than
    // shrinking the photographs into uselessness.
    expect(layoutFor(40).pages).toBeGreaterThan(TARGET_PAGES);
  });

  it("grows the photograph with the row", () => {
    expect(layoutFor(3).photoHeight).toBeGreaterThan(layoutFor(15).photoHeight);
    for (const count of [1, 3, 8, 15, 40]) {
      const layout = layoutFor(count);
      expect(layout.photoHeight).toBeLessThan(layout.rowHeight);
      expect(layout.photoWidth).toBeGreaterThan(0);
    }
  });

  it("makes even the tightest photograph bigger than the old fixed one", () => {
    // Fifteen tools is the worst case and it still beats the fifty-point
    // square that everything used to get.
    expect(layoutFor(15).photoHeight).toBeGreaterThan(50);
  });
});

describe("splitting a kit over pages", () => {
  it("never drops a tool off the end", () => {
    const many = Array.from({ length: 25 }, (_, i) => tool(`Tool ${i}`));
    expect(paginate(many).flat()).toHaveLength(25);
  });

  it("fills each page before starting the next", () => {
    const perPage = layoutFor(16).rowsPerPage;
    const many = Array.from({ length: 16 }, (_, i) => tool(`Tool ${i}`));
    expect(paginate(many, perPage)[0]).toHaveLength(perPage);
  });

  it("still prints a page for an empty kit", () => {
    // "This kit exists and nothing is in it" is a different fact from the kit
    // not being on the pile, and it is worth a sheet.
    expect(paginate([])).toEqual([[]]);
  });
});

describe("how many of it belong in the kit", () => {
  const shovel = tool("Flat Shovel", { quantity: 3, kits: [1, 2], kitQuantities: { "2": 2 } });

  it("is one unless somebody has said otherwise", () => {
    // We own three. The kit takes one. Printing "x 3" beside a kit holding one
    // sends somebody looking for two that were never in the van.
    expect(kitQuantity(shovel, 1)).toBe(1);
  });

  it("takes the number set for that kit", () => {
    expect(kitQuantity(shovel, 2)).toBe(2);
  });

  it("counts each kit separately", () => {
    expect(kitQuantity(shovel, 1)).not.toBe(kitQuantity(shovel, 2));
  });

  it("falls back to one for rubbish", () => {
    expect(kitQuantity(tool("x", { kits: [1], kitQuantities: { "1": 0 } }), 1)).toBe(1);
    expect(kitQuantity(tool("y", { kits: [1] }), 1)).toBe(1);
  });

  it("uses what we own on the full inventory, which is not a kit", () => {
    expect(kitQuantity(shovel, null)).toBe(3);
    expect(kitQuantity(tool("z"), null)).toBe(1);
  });
});

describe("the columns across a row", () => {
  it("keeps everything inside the margins", () => {
    for (const hasHowTo of [true, false]) {
      const c = columns(hasHowTo, 120);
      expect(c.checkbox).toBeGreaterThanOrEqual(0);
      expect(c.text + c.textWidth).toBeLessThanOrEqual(PAGE_WIDTH - 2 * MARGIN + 1e-9);
    }
  });

  it("runs left to right: box, photograph, words", () => {
    const c = columns(true, 120);
    expect(c.checkbox).toBeLessThan(c.photo);
    expect(c.photo).toBeLessThan(c.text);
    expect(c.text).toBeLessThan(c.qr);
  });

  it("gives the words the space the codes are not using", () => {
    // Nothing has a how-to link yet, and until something does the names and
    // descriptions should have the whole width rather than a gap held open.
    expect(columns(false, 120).textWidth).toBeGreaterThan(columns(true, 120).textWidth);
  });

  it("narrows the words when the photograph grows, rather than running off the page", () => {
    const wide = columns(true, 210);
    const narrow = columns(true, 60);
    expect(wide.textWidth).toBeLessThan(narrow.textWidth);
    expect(wide.text + wide.textWidth).toBeLessThanOrEqual(PAGE_WIDTH - 2 * MARGIN + 1e-9);
  });
});

describe("what a row says", () => {
  it("mentions a count only when there is more than one", () => {
    expect(countLabel(1)).toBeNull();
    expect(countLabel(null)).toBeNull();
    expect(countLabel(3)).toBe("× 3");
  });

  it("says where it goes back to", () => {
    expect(whereLabel(tool("x", { storageLocation: "Shelf B" }))).toBe("Shelf B");
  });

  it("admits when nobody has said where it goes", () => {
    // Silence would read as "anywhere", which is how tools end up in the
    // wrong bin and nobody can say it was wrong.
    expect(whereLabel(tool("x"))).toBe("No bin set");
    expect(whereLabel(tool("x", { storageLocation: "   " }))).toBe("No bin set");
  });
});

describe("what the file is called", () => {
  it("names the kit, so two printouts do not overwrite each other", () => {
    expect(fileNameFor(sheetsFor(SHOP, "2"), "J's Landscaping")).toBe("j-s-landscaping-kit-2-checklist.pdf");
  });

  it("says kits when it is all of them", () => {
    expect(fileNameFor(sheetsFor(SHOP, "all"), "J's Landscaping")).toBe("j-s-landscaping-kits-checklist.pdf");
  });

  it("copes with a business whose name is all punctuation", () => {
    expect(fileNameFor(sheetsFor(SHOP, "all"), "&&&")).toBe("kits-checklist.pdf");
  });

  it("opens in the browser unless a download was asked for", () => {
    const sheets = sheetsFor(SHOP, "2");
    expect(contentDisposition(sheets, "J's", false)).toMatch(/^inline;/);
    expect(contentDisposition(sheets, "J's", true)).toMatch(/^attachment;/);
  });
});

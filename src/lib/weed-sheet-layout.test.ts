import { describe, expect, it } from "vitest";

import {
  columnX,
  contentDisposition,
  fileNameFor,
  geometryFor,
  GAP,
  MARGIN_SIDE,
  MARGIN_TOP,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  paginate,
  truncate,
  wrapText,
  type Block,
} from "@/lib/weed-sheet-layout";

/** A stand-in for a font: every character is one unit wide. */
const monospace = (line: string) => line.length;

describe("the sheet's measurements", () => {
  it("is letter paper", () => {
    expect(PAGE_WIDTH / 72).toBeCloseTo(8.5, 5);
    expect(PAGE_HEIGHT / 72).toBeCloseTo(11, 5);
  });

  it("keeps everything at least a third of an inch from the paper's edge", () => {
    // This is the whole reason the PDF exists: the printer's unprintable strip
    // is about a quarter of an inch and nothing may land in it.
    const g = geometryFor("crew");
    expect(MARGIN_TOP / 72).toBeGreaterThan(0.25);
    expect(MARGIN_SIDE / 72).toBeGreaterThan(0.25);
    expect(g.contentHeight + 2 * 34).toBe(PAGE_HEIGHT);
  });

  it("gives the client four across and the crew five", () => {
    expect(geometryFor("client").columns).toBe(4);
    expect(geometryFor("crew").columns).toBe(5);
  });

  it("makes the columns and the gaps add up to the content width exactly", () => {
    for (const view of ["client", "crew"] as const) {
      const g = geometryFor(view);
      const across = g.columns * g.cellWidth + (g.columns - 1) * GAP;
      expect(across).toBeCloseTo(g.contentWidth, 6);
    }
  });

  it("puts the last column's right edge on the margin", () => {
    for (const view of ["client", "crew"] as const) {
      const g = geometryFor(view);
      const right = columnX(g, g.columns - 1) + g.cellWidth;
      expect(right).toBeCloseTo(PAGE_WIDTH - MARGIN_SIDE, 6);
    }
  });

  it("starts the first column on the left margin", () => {
    expect(columnX(geometryFor("crew"), 0)).toBe(MARGIN_SIDE);
  });

  it("gives the crew's cell the two extra lines its sheet carries", () => {
    // The scientific name and the prep note; the client's sheet has neither.
    expect(geometryFor("crew").cellHeight).toBeGreaterThan(0);
    const clientPerLine = geometryFor("client");
    expect(clientPerLine.photoHeight).toBeGreaterThan(geometryFor("crew").photoHeight);
  });

  it("fits at least three rows on a page either way", () => {
    for (const view of ["client", "crew"] as const) {
      const g = geometryFor(view);
      expect(Math.floor(g.contentHeight / g.rowHeight)).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps the code big enough to scan", () => {
    // A 29-module code with its quiet zone is 33 modules across. A third of a
    // point per module is where a phone camera starts to fail.
    for (const view of ["client", "crew"] as const) {
      expect(geometryFor(view).qrSize / 33).toBeGreaterThan(1.3);
    }
  });
});

function row(height = 100): Block<string> {
  return { kind: "row", weeds: ["w"], height };
}

describe("dealing the blocks onto pages", () => {
  it("puts what fits on one page", () => {
    const pages = paginate([row(), row(), row()], 400);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(3);
  });

  it("starts a new page rather than cutting a row in half", () => {
    const pages = paginate([row(), row(), row()], 250);
    expect(pages.map((p) => p.length)).toEqual([2, 1]);
  });

  it("measures every page from the top margin, not from where the last one ended", () => {
    const pages = paginate([row(), row(), row()], 250);
    expect(pages[0][0].top).toBe(MARGIN_TOP);
    expect(pages[1][0].top).toBe(MARGIN_TOP);
  });

  it("stacks blocks down the page by their own heights", () => {
    const pages = paginate([row(100), row(100)], 400);
    expect(pages[0][1].top).toBe(MARGIN_TOP + 100);
  });

  it("never leaves a heading alone at the foot of a page", () => {
    const blocks: Block<string>[] = [row(100), { kind: "heading", text: "Sedges", height: 20 }, row(100)];
    const pages = paginate(blocks, 160);
    // 100 + 20 fits, but 100 + 20 + 100 does not, so the heading goes over
    // with the row it names rather than pointing at the wrong page.
    expect(pages[0].map((p) => p.block.kind)).toEqual(["row"]);
    expect(pages[1].map((p) => p.block.kind)).toEqual(["heading", "row"]);
  });

  it("puts a heading down anyway when it is the last thing there is", () => {
    const pages = paginate<string>([{ kind: "heading", text: "Sedges", height: 20 }], 160);
    expect(pages).toHaveLength(1);
  });

  it("keeps a block that is taller than a page rather than dropping it", () => {
    const pages = paginate([row(500)], 400);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(1);
  });

  it("gives back no pages for nothing to put on them", () => {
    expect(paginate([], 400)).toEqual([]);
  });

  it("loses nothing", () => {
    const blocks = [row(90), row(90), row(90), row(90), row(90)];
    const pages = paginate(blocks, 200);
    expect(pages.flat()).toHaveLength(blocks.length);
  });
});

describe("wrapping a name to the width of its cell", () => {
  it("leaves a short name alone", () => {
    expect(wrapText("Dandelion", 20, 2, monospace)).toEqual(["Dandelion"]);
  });

  it("breaks between words", () => {
    expect(wrapText("Broadleaf Plantain", 10, 2, monospace)).toEqual(["Broadleaf", "Plantain"]);
  });

  it("stops at the lines it has room for and says so with an ellipsis", () => {
    const lines = wrapText("one two three four five", 5, 2, monospace);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
  });

  it("keeps a single word that is wider than the cell, cut to fit", () => {
    const [line] = wrapText("Schedonorus", 6, 1, monospace);
    expect(line.endsWith("…")).toBe(true);
    expect(monospace(line)).toBeLessThanOrEqual(6);
  });

  it("gives back nothing for nothing", () => {
    expect(wrapText("", 20, 2, monospace)).toEqual([]);
    expect(wrapText("   ", 20, 2, monospace)).toEqual([]);
  });

  it("gives back nothing when there is no room for a line", () => {
    expect(wrapText("Dandelion", 20, 0, monospace)).toEqual([]);
  });

  it("does not add an ellipsis when everything fitted", () => {
    expect(wrapText("one two", 10, 2, monospace).join(" ")).toBe("one two");
  });
});

describe("cutting one line to fit", () => {
  it("leaves it alone when it already fits", () => {
    expect(truncate("short", 10, monospace)).toBe("short");
  });

  it("ends with an ellipsis and stays inside the width", () => {
    const cut = truncate("Ornithogalum umbellatum", 8, monospace);
    expect(cut.endsWith("…")).toBe(true);
    expect(monospace(cut)).toBeLessThanOrEqual(8);
  });
});

describe("what the file is called", () => {
  it("says whose it is and which sheet it is", () => {
    expect(fileNameFor("client", "JS Landscaping MD")).toBe("js-landscaping-md-weed-sheet.pdf");
    expect(fileNameFor("crew", "JS Landscaping MD")).toBe("js-landscaping-md-weed-reference.pdf");
  });

  it("still names the file when the business has no usable name", () => {
    expect(fileNameFor("client", "")).toBe("weed-sheet.pdf");
    expect(fileNameFor("crew", "!!!")).toBe("weed-reference.pdf");
  });

  it("does not leave a stray dash at either end", () => {
    expect(fileNameFor("client", "  Green & Co.  ")).toBe("green-co-weed-sheet.pdf");
  });
});

describe("how the browser is told to treat the file", () => {
  it("opens it rather than saving it", () => {
    // Saved, it lands in Files on a phone with no viewer and no print button,
    // which is the one thing this file exists for.
    expect(contentDisposition("client", "JS Landscaping MD", false)).toBe(
      'inline; filename="js-landscaping-md-weed-sheet.pdf"'
    );
  });

  it("saves it when the link asked for that", () => {
    expect(contentDisposition("crew", "JS Landscaping MD", true)).toBe(
      'attachment; filename="js-landscaping-md-weed-reference.pdf"'
    );
  });

  it("carries the name either way, so saving from the viewer still names it", () => {
    for (const download of [true, false]) {
      expect(contentDisposition("client", "Green & Co.", download)).toContain("green-co-weed-sheet.pdf");
    }
  });
});

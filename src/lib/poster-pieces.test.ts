import { describe, expect, it } from "vitest";

import {
  fitsASheet,
  inchesAndSixteenths,
  MAX_PIECE_HEIGHT,
  MAX_PIECE_WIDTH,
  overlaps,
  planPieces,
  rowPieces,
  type Board,
  type Measure,
} from "@/lib/poster-pieces";

/** A stand-in font: every character half the point size wide. */
const halfWidth: Measure = (text, size) => text.length * size * 0.5;

const FRAME: Board = { width: 20, height: 30 };

/** The pieces grouped by the line of the phrase they sit on. */
function byLine(pieces: ReturnType<typeof rowPieces>) {
  const lines = new Map<number, typeof pieces>();
  for (const piece of pieces) {
    const list = lines.get(piece.y) ?? [];
    list.push(piece);
    lines.set(piece.y, list);
  }
  return Array.from(lines.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, list]) => list.sort((a, b) => a.x - b.x));
}

describe("one line, as the cutouts it becomes", () => {
  it("keeps a short line as one cutout", () => {
    const pieces = rowPieces(
      { id: "get-a", text: "GET A", capHeight: 1, fill: null, colour: "#000000" },
      FRAME,
      halfWidth,
      1
    );
    expect(pieces).toHaveLength(1);
    expect(pieces[0].id).toBe("get-a");
    expect(pieces[0].text).toBe("GET A");
  });

  it("splits a line too wide for a sheet at a word, not mid-word", () => {
    const pieces = rowPieces(
      { id: "scan", text: "SCAN TO CLAIM YOUR DISCOUNT", capHeight: 1.4, fill: null, colour: "#000000" },
      FRAME,
      halfWidth,
      1
    );
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.map((p) => p.text).join(" ")).toBe("SCAN TO CLAIM YOUR DISCOUNT");
  });

  it("numbers the cutouts of a split line", () => {
    const pieces = rowPieces(
      { id: "scan", text: "SCAN TO CLAIM YOUR DISCOUNT", capHeight: 1.4, fill: null, colour: "#000000" },
      FRAME,
      halfWidth,
      1
    );
    expect(pieces.map((p) => p.id)).toEqual(pieces.map((_, i) => `scan-${i + 1}`));
  });

  it("never puts a cutout wider than a sheet", () => {
    const pieces = rowPieces(
      { id: "long", text: "IN YOUR NEIGHBORHOOD THIS WEEK", capHeight: 2, fill: null, colour: "#000000" },
      FRAME,
      halfWidth,
      1
    );
    for (const piece of pieces) expect(piece.width).toBeLessThanOrEqual(MAX_PIECE_WIDTH + 1e-9);
  });

  it("brings the type down when one word alone will not fit a sheet", () => {
    // Splitting cannot help a single word, so the only way through is smaller.
    const big = rowPieces(
      { id: "one", text: "NEIGHBORHOOD", capHeight: 6, fill: null, colour: "#000000" },
      FRAME,
      halfWidth,
      1
    );
    expect(big).toHaveLength(1);
    expect(fitsASheet(big[0])).toBe(true);
    expect(big[0].fontSize * 0.72).toBeLessThan(6);
  });

  it("centres every line across the board", () => {
    const pieces = rowPieces(
      { id: "row", text: "SCAN TO CLAIM YOUR DISCOUNT", capHeight: 1.4, fill: null, colour: "#000000" },
      FRAME,
      halfWidth,
      1
    );
    for (const line of byLine(pieces)) {
      const left = line[0].x;
      const right = FRAME.width - (line[line.length - 1].x + line[line.length - 1].width);
      expect(left).toBeCloseTo(right, 6);
    }
  });

  it("leaves a gap between two cutouts, because that gap is the word space", () => {
    const pieces = rowPieces(
      { id: "row", text: "SCAN TO CLAIM YOUR DISCOUNT", capHeight: 1.4, fill: null, colour: "#000000" },
      FRAME,
      halfWidth,
      1
    );
    for (const line of byLine(pieces)) {
      for (let i = 1; i < line.length; i += 1) {
        const gap = line[i].x - (line[i - 1].x + line[i - 1].width);
        expect(gap).toBeGreaterThan(0.1);
      }
    }
  });

  it("sets every cutout of a line at the same size, so the line reads as one", () => {
    const pieces = rowPieces(
      { id: "row", text: "SCAN TO CLAIM YOUR DISCOUNT", capHeight: 1.4, fill: null, colour: "#000000" },
      FRAME,
      halfWidth,
      1
    );
    for (const piece of pieces) expect(piece.fontSize).toBeCloseTo(pieces[0].fontSize, 9);
  });

  it("is nothing for nothing", () => {
    const blank = { id: "x", text: "   ", capHeight: 1, fill: null, colour: "#000000" };
    expect(rowPieces(blank, FRAME, halfWidth, 1)).toEqual([]);
    expect(
      rowPieces({ id: "x", text: "WORDS", capHeight: 0, fill: null, colour: "#000000" }, FRAME, halfWidth, 1)
    ).toEqual([]);
  });
});

describe("a phrase too wide for the board", () => {
  it("wraps onto a second line rather than shrinking to fit across", () => {
    // The change that made the small lines readable. A long phrase used to
    // bring its own type down until it fitted the board in one go, so the
    // call to action ended up half the height of the word above it.
    const wide = rowPieces(
      { id: "scan", text: "SCAN TO CLAIM YOUR DISCOUNT", capHeight: 1.4, fill: null, colour: "#000" },
      FRAME,
      halfWidth,
      1
    );
    expect(byLine(wide).length).toBeGreaterThan(1);
    // And kept the size it asked for, since no single word needed cutting down.
    expect(wide[0].fontSize * 0.72).toBeCloseTo(1.4, 6);
  });

  it("keeps every line inside the board", () => {
    const pieces = rowPieces(
      { id: "scan", text: "SCAN TO CLAIM YOUR DISCOUNT", capHeight: 1.4, fill: null, colour: "#000" },
      FRAME,
      halfWidth,
      1
    );
    for (const piece of pieces) {
      expect(piece.x).toBeGreaterThanOrEqual(-1e-9);
      expect(piece.x + piece.width).toBeLessThanOrEqual(FRAME.width + 1e-9);
    }
  });

  it("stacks the lines rather than printing them through each other", () => {
    const lines = byLine(
      rowPieces(
        { id: "scan", text: "SCAN TO CLAIM YOUR DISCOUNT", capHeight: 1.4, fill: null, colour: "#000" },
        FRAME,
        halfWidth,
        1
      )
    );
    for (let i = 1; i < lines.length; i += 1) {
      expect(lines[i][0].y).toBeGreaterThanOrEqual(lines[i - 1][0].y + lines[i - 1][0].height);
    }
  });

  it("shares the words out evenly instead of stranding one on the last line", () => {
    // Filling each line to the brim left "truck." alone under a full line,
    // which reads as a mistake rather than as a second line.
    const lines = byLine(
      rowPieces(
        { id: "f", text: "Can't scan? Call or text the number on our truck.", capHeight: 0.6, fill: null, colour: "#000" },
        FRAME,
        halfWidth,
        1
      )
    );
    const widths = lines.map((line) =>
      line.reduce((total, piece) => total + piece.width, 0)
    );
    const widest = Math.max(...widths);
    const narrowest = Math.min(...widths);
    expect(narrowest / widest).toBeGreaterThan(0.5);
  });

  it("says the whole phrase, in order, however it wrapped", () => {
    const pieces = rowPieces(
      { id: "scan", text: "SCAN TO CLAIM YOUR DISCOUNT", capHeight: 1.4, fill: null, colour: "#000" },
      FRAME,
      halfWidth,
      1
    );
    expect(byLine(pieces).flat().map((p) => p.text).join(" ")).toBe("SCAN TO CLAIM YOUR DISCOUNT");
  });

  it("numbers the cutouts straight through, not restarting each line", () => {
    const pieces = rowPieces(
      { id: "scan", text: "SCAN TO CLAIM YOUR DISCOUNT", capHeight: 1.4, fill: null, colour: "#000" },
      FRAME,
      halfWidth,
      1
    );
    expect(pieces.map((p) => p.id)).toEqual(pieces.map((_, i) => `scan-${i + 1}`));
  });
});

describe("the whole sign, as cutouts", () => {
  const plan = planPieces(FRAME, "J's Landscaping", halfWidth);

  it("says everything the sign has to say", () => {
    const said = plan.pieces.map((p) => p.text).join(" ");
    expect(said).toContain("J'S LANDSCAPING");
    expect(said).toContain("WE'RE WORKING");
    expect(said).toContain("IN YOUR NEIGHBORHOOD");
    expect(said).toContain("DISCOUNT");
    expect(said.toLowerCase()).toContain("scan");
  });

  it("includes the code as a cutout of its own", () => {
    const qr = plan.pieces.filter((p) => p.kind === "qr");
    expect(qr).toHaveLength(1);
    expect(qr[0].width).toBeCloseTo(qr[0].height, 9);
  });

  it("prints every cutout on one sheet — that is the whole point", () => {
    for (const piece of plan.pieces) {
      expect(fitsASheet(piece), `${piece.id} is ${piece.width}×${piece.height}in`).toBe(true);
    }
  });

  it("never lands one cutout on top of another", () => {
    for (let i = 0; i < plan.pieces.length; i += 1) {
      for (let j = i + 1; j < plan.pieces.length; j += 1) {
        expect(overlaps(plan.pieces[i], plan.pieces[j]), `${plan.pieces[i].id} and ${plan.pieces[j].id}`).toBe(
          false
        );
      }
    }
  });

  it("keeps every cutout on the board", () => {
    for (const piece of plan.pieces) {
      expect(piece.x).toBeGreaterThanOrEqual(-1e-9);
      expect(piece.y).toBeGreaterThanOrEqual(-1e-9);
      expect(piece.x + piece.width).toBeLessThanOrEqual(FRAME.width + 1e-9);
      expect(piece.y + piece.height).toBeLessThanOrEqual(FRAME.height + 1e-9);
    }
  });

  it("runs down the board in the order it is read", () => {
    const order = ["name", "working", "neighborhood", "get-a", "offer-1", "offer-2", "scan", "qr", "fallback"];
    const seen = order.map((id) => plan.pieces.find((p) => p.id === id || p.id.startsWith(`${id}-`))!.y);
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
  });

  it("gives the offer the biggest type, because it is the thing being decided", () => {
    const size = (id: string) => plan.pieces.find((p) => p.id.startsWith(id))!.fontSize;
    expect(size("offer-2")).toBeGreaterThan(size("neighborhood"));
    expect(size("offer-2")).toBeGreaterThan(size("name"));
  });

  it("puts the offer on green and the rest on white paper", () => {
    const fill = (id: string) => plan.pieces.find((p) => p.id.startsWith(id))!.fill;
    expect(fill("offer-1")).not.toBeNull();
    expect(fill("get-a")).not.toBeNull();
    expect(fill("working")).toBeNull();
  });

  it("still fits a frame half the size", () => {
    const small = planPieces({ width: 11, height: 17 }, "J's Landscaping", halfWidth);
    for (const piece of small.pieces) expect(fitsASheet(piece)).toBe(true);
    for (const piece of small.pieces) {
      expect(piece.x + piece.width).toBeLessThanOrEqual(11 + 1e-9);
      expect(piece.y + piece.height).toBeLessThanOrEqual(17 + 1e-9);
    }
  });

  it("still fits a frame bigger than the paper is wide", () => {
    const big = planPieces({ width: 24, height: 36 }, "Green Acres Lawn And Landscape", halfWidth);
    for (const piece of big.pieces) expect(fitsASheet(piece)).toBe(true);
  });

  it("copes with a business name long enough to need cutting apart", () => {
    const plan2 = planPieces(FRAME, "Jordan And Sons Landscaping And Snow Removal", halfWidth);
    const name = plan2.pieces.filter((p) => p.id.startsWith("name"));
    expect(name.length).toBeGreaterThan(0);
    for (const piece of name) expect(fitsASheet(piece)).toBe(true);
  });

  it("never needs a cutout taller than a sheet is deep", () => {
    for (const piece of plan.pieces) expect(piece.height).toBeLessThanOrEqual(MAX_PIECE_HEIGHT + 1e-9);
  });
});

describe("the order of the lines, against real capitals", () => {
  /**
   * Capitals in Helvetica Bold run about seven tenths of the point size wide.
   * The half-width stand-in above is narrow enough that nothing ever hits the
   * sheet limit, which is the one thing that can quietly invert the design.
   */
  const wideCaps: Measure = (text, size) => text.length * size * 0.7;
  const plan = planPieces(FRAME, "J's Landscaping", wideCaps);
  const cap = (id: string) => {
    const piece = plan.pieces.find((p) => p.id === id || p.id.startsWith(`${id}-`))!;
    return piece.fontSize * 0.72;
  };

  it("still fits every cutout on a sheet", () => {
    for (const piece of plan.pieces) expect(fitsASheet(piece)).toBe(true);
  });

  it("keeps the shout the biggest thing on the sign", () => {
    // A word cannot be wider than a sheet, so a line asking for more than that
    // is silently cut down to it. Ask for two inches of capital on
    // "NEIGHBORHOOD" and you get four fifths — which once left "GET A", the
    // small lead-in, set larger than the offer it leads into.
    for (const other of ["neighborhood", "get-a", "scan", "fallback", "name", "offer-1"]) {
      expect(cap("working"), `working vs ${other}`).toBeGreaterThan(cap(other));
    }
  });

  it("keeps the lead-in smaller than what it leads into", () => {
    expect(cap("get-a")).toBeLessThan(cap("offer-1"));
    expect(cap("get-a")).toBeLessThan(cap("offer-2"));
  });

  it("keeps the offer's second line the loudest of the three", () => {
    expect(cap("offer-2")).toBeGreaterThan(cap("offer-1"));
    expect(cap("offer-2")).toBeGreaterThan(cap("scan"));
  });

  it("keeps the small print the smallest thing on it", () => {
    const others = ["name", "working", "neighborhood", "get-a", "offer-1", "offer-2", "scan"];
    for (const other of others) expect(cap("fallback")).toBeLessThan(cap(other));
  });
});

describe("inches on a tape measure", () => {
  it("leaves a whole number alone", () => {
    expect(inchesAndSixteenths(4)).toBe("4in");
  });

  it("reduces the fraction rather than saying eight sixteenths", () => {
    expect(inchesAndSixteenths(4.5)).toBe("4 1/2in");
    expect(inchesAndSixteenths(4.25)).toBe("4 1/4in");
    expect(inchesAndSixteenths(4.0625)).toBe("4 1/16in");
    expect(inchesAndSixteenths(4.375)).toBe("4 3/8in");
  });

  it("rounds up to the next whole inch rather than saying sixteen sixteenths", () => {
    expect(inchesAndSixteenths(3.99)).toBe("4in");
  });

  it("copes with nothing", () => {
    expect(inchesAndSixteenths(0)).toBe("0in");
  });
});

describe("what a sheet can carry", () => {
  it("is the paper less its margins, landscape", () => {
    expect(MAX_PIECE_WIDTH).toBeGreaterThan(MAX_PIECE_HEIGHT);
    expect(MAX_PIECE_WIDTH).toBeCloseTo(10.4, 9);
    expect(MAX_PIECE_HEIGHT).toBeCloseTo(7.9, 9);
  });

  it("turns a piece down when it is over either way", () => {
    const base = { id: "x", kind: "text" as const, text: "", fontSize: 1, x: 0, y: 0, fill: null, colour: "#000" };
    expect(fitsASheet({ ...base, width: 11, height: 2 })).toBe(false);
    expect(fitsASheet({ ...base, width: 2, height: 8 })).toBe(false);
    expect(fitsASheet({ ...base, width: 10, height: 7 })).toBe(true);
  });
});

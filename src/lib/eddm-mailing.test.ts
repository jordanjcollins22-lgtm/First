import { describe, expect, it } from "vitest";

import { bundlesFor, mailingSummary, piecesFor, suggestedName, unionBoundary, type MailingRoute } from "@/lib/eddm-mailing";

const route = (over: Partial<MailingRoute> = {}): MailingRoute => ({
  zip: "21014",
  routeId: "C002",
  residential: 538,
  business: 82,
  total: 620,
  facility: "BEL AIR",
  ...over,
});

describe("piecesFor", () => {
  it("counts homes only, or homes and businesses, as the mailer chooses", () => {
    expect(piecesFor(route(), "residential")).toBe(538);
    expect(piecesFor(route(), "all")).toBe(620);
  });

  it("works from whichever counts USPS gave", () => {
    expect(piecesFor(route({ residential: null }), "residential")).toBe(538);
    expect(piecesFor(route({ total: null }), "all")).toBe(620);
  });
});

describe("mailingSummary", () => {
  const rates = { postagePerPiece: 0.222, printCostPerPiece: 0.08 };

  it("prices a mailing at the flat rate, plus in-house printing", () => {
    const summary = mailingSummary([route(), route({ routeId: "C005", residential: 300, business: 10, total: 310 })], "residential", rates);
    expect(summary.pieces).toBe(838);
    expect(summary.postageCents).toBe(838 * 22); // 22.2 cents rounds to 22 per piece
    expect(summary.printCents).toBe(838 * 8);
    expect(summary.totalCents).toBe(838 * 30);
    expect(summary.facilities).toEqual(["BEL AIR"]);
    expect(summary.bundles).toBe(6 + 3);
  });

  it("has no price until the postage rate is entered", () => {
    const summary = mailingSummary([route()], "residential", { postagePerPiece: null, printCostPerPiece: 0 });
    expect(summary.postageCents).toBeNull();
    expect(summary.totalCents).toBeNull();
  });

  it("flags a ZIP that would be refused at the counter", () => {
    // 150 pieces in one ZIP: under the minimum. 6,000 in another: over a day.
    const summary = mailingSummary(
      [
        route({ zip: "21005", routeId: "R001", residential: 150, total: 160 }),
        route({ zip: "21009", routeId: "C010", residential: 6000, total: 6100 }),
        route(),
      ],
      "residential",
      rates
    );
    const byZip = Object.fromEntries(summary.perZip.map((z) => [z.zip, z]));
    expect(byZip["21005"].ok).toBe(false);
    expect(byZip["21005"].problem).toMatch(/minimum/);
    expect(byZip["21009"].ok).toBe(false);
    expect(byZip["21009"].problem).toMatch(/split/);
    expect(byZip["21014"].ok).toBe(true);
  });
});

describe("bundlesFor", () => {
  it("ties pieces into hundreds and a remainder", () => {
    expect(bundlesFor(620)).toEqual([100, 100, 100, 100, 100, 100, 20]);
    expect(bundlesFor(0)).toEqual([]);
  });
});

describe("suggestedName", () => {
  it("names a mailing by its ZIP and routes", () => {
    expect(suggestedName([route(), route({ routeId: "C005" })])).toBe("EDDM 21014 C002, C005");
    expect(suggestedName([])).toBe("EDDM mailing");
  });
});

describe("unionBoundary", () => {
  it("merges touching routes into one outline", () => {
    const a: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const b: [number, number][] = [[1, 0], [2, 0], [2, 1], [1, 1]];
    const ring = unionBoundary([a, b]);
    expect(ring).not.toBeNull();
    const lngs = ring!.map(([lng]) => lng);
    expect(Math.min(...lngs)).toBe(0);
    expect(Math.max(...lngs)).toBe(2);
  });

  it("still gives one outline for routes that do not touch", () => {
    const a: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const far: [number, number][] = [[5, 5], [6, 5], [6, 6], [5, 6]];
    expect(unionBoundary([a, far])?.length ?? 0).toBeGreaterThan(2);
    expect(unionBoundary([])).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { covers, inTerritory, pointInPolygon, readAreas, readZips, writeAreas, type Territory } from "@/lib/sales/territories";
import { chooseEvaluator, type EvaluatorDay } from "@/lib/evaluator-choice";

/** A box around Bel Air. */
const BEL_AIR = [
  { lat: 39.5, lng: -76.4 },
  { lat: 39.5, lng: -76.3 },
  { lat: 39.6, lng: -76.3 },
  { lat: 39.6, lng: -76.4 },
];
const IN_BEL_AIR = { lat: 39.536, lng: -76.348, zip: null };
const ABERDEEN = { lat: 39.51, lng: -76.16, zip: "21001" };

const territory = (evaluatorId: string, over: Partial<Territory> = {}): Territory => ({ evaluatorId, zips: [], areas: [], active: true, ...over });
const day = (evaluatorId: string, over: Partial<EvaluatorDay> = {}): EvaluatorDay => ({ evaluatorId, visits: [], lastBookedAt: null, ...over });

describe("territory geometry", () => {
  it("reads zips out of whatever was typed", () => {
    expect(readZips("21014, 21015 21050-1234 21014")).toEqual(["21014", "21015", "21050"]);
    expect(readZips(null)).toEqual([]);
  });

  it("knows inside from outside", () => {
    expect(pointInPolygon(IN_BEL_AIR, BEL_AIR)).toBe(true);
    expect(pointInPolygon(ABERDEEN, BEL_AIR)).toBe(false);
    expect(pointInPolygon(IN_BEL_AIR, BEL_AIR.slice(0, 2))).toBe(false);
  });

  it("covers by zip or by drawn area, and an inactive one covers nothing", () => {
    expect(covers(territory("a", { zips: ["21001"] }), ABERDEEN)).toBe(true);
    expect(covers(territory("a", { areas: [BEL_AIR] }), IN_BEL_AIR)).toBe(true);
    expect(covers(territory("a", { areas: [BEL_AIR], active: false }), IN_BEL_AIR)).toBe(false);
    expect(covers(territory("a"), IN_BEL_AIR)).toBe(false);
  });

  it("round-trips drawn areas as GeoJSON-order rings", () => {
    const stored = writeAreas([BEL_AIR]);
    expect(stored[0][0]).toEqual([-76.4, 39.5]);
    expect(readAreas(stored)).toEqual([BEL_AIR]);
    // A closed ring drops its repeated point; junk is skipped.
    expect(readAreas([[...stored[0], stored[0][0]], "nonsense", [[1, 2]]])).toEqual([BEL_AIR]);
  });

  it("filters the free to the ones whose patch it is", () => {
    const list = [territory("a", { areas: [BEL_AIR] }), territory("b", { zips: ["21001"] })];
    expect(inTerritory(["a", "b", "c"], list, IN_BEL_AIR)).toEqual(["a"]);
    expect(inTerritory(["b", "c"], list, IN_BEL_AIR)).toEqual([]);
  });
});

describe("choosing an evaluator with territories", () => {
  it("gives it to the one whose territory it is, over a lighter day elsewhere", () => {
    const choice = chooseEvaluator(["a", "b"], [day("a", { visits: [{ lat: 39.9, lng: -76.9 }] }), day("b")], IN_BEL_AIR, [territory("a", { areas: [BEL_AIR] })]);
    expect(choice?.evaluatorId).toBe("a");
    expect(choice?.why).toMatch(/territory/);
  });

  it("matches on the zip when the booking has one", () => {
    const choice = chooseEvaluator(["a", "b"], [day("a"), day("b", { visits: [{ lat: 40, lng: -77 }] })], ABERDEEN, [territory("b", { zips: ["21001"] })]);
    expect(choice?.evaluatorId).toBe("b");
  });

  it("falls back to everybody free when nobody's territory covers it", () => {
    const choice = chooseEvaluator(["a", "b"], [day("a", { visits: [{ lat: 40, lng: -77 }] }), day("b")], ABERDEEN, [territory("a", { areas: [BEL_AIR] })]);
    expect(choice?.evaluatorId).toBe("b");
    expect(choice?.why).not.toMatch(/territory/);
  });

  it("splits between two who share the territory by the usual rules", () => {
    const choice = chooseEvaluator(
      ["a", "b", "c"],
      [day("a", { visits: [{ lat: 40, lng: -77 }] }), day("b"), day("c")],
      IN_BEL_AIR,
      [territory("a", { areas: [BEL_AIR] }), territory("b", { areas: [BEL_AIR] })]
    );
    expect(choice?.evaluatorId).toBe("b");
    expect(choice?.why).toMatch(/^In their territory/);
  });

  it("behaves exactly as before with no territories", () => {
    const choice = chooseEvaluator(["a", "b"], [day("a", { visits: [{ lat: 40, lng: -77 }] }), day("b")], IN_BEL_AIR);
    expect(choice?.evaluatorId).toBe("b");
  });
});

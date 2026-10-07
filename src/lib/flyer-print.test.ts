import { describe, expect, it } from "vitest";

import { clampLoad, printPlan, TRAYS } from "@/lib/flyer-print";

describe("printPlan", () => {
  it("sets aside one sheet per flyer and counts whole packs", () => {
    const plan = printPlan(522, TRAYS.bypass.sheets);
    expect(plan.sheets).toBe(522);
    expect(plan.packs).toBe(2);
    expect(plan.leftInLastPack).toBe(478);
  });

  it("cuts the run into tray loads, the last one short", () => {
    const plan = printPlan(522, 50);
    expect(plan.loads).toHaveLength(11);
    expect(plan.loads[0]).toEqual({ number: 1, from: 1, to: 50, sheets: 50 });
    expect(plan.loads[10]).toEqual({ number: 11, from: 501, to: 522, sheets: 22 });
    expect(plan.loads.reduce((sum, l) => sum + l.sheets, 0)).toBe(522);
  });

  it("carries on from the next flyer when the tray changes halfway", () => {
    const plan = printPlan(522, 250, 150);
    expect(plan.printed).toBe(150);
    expect(plan.loads.map((l) => [l.from, l.to])).toEqual([
      [151, 400],
      [401, 522],
    ]);
  });

  it("has nothing left once every flyer is through", () => {
    expect(printPlan(522, 50, 522).loads).toEqual([]);
    expect(printPlan(522, 50, 900).printed).toBe(522);
  });

  it("is a full pack exactly with nothing left over", () => {
    const plan = printPlan(1000, 50);
    expect(plan.packs).toBe(2);
    expect(plan.leftInLastPack).toBe(0);
  });
});

describe("clampLoad", () => {
  it("never runs past the mailing", () => {
    expect(clampLoad(501, 50, 522)).toEqual({ from: 501, count: 22 });
  });

  it("never sends more than a tray holds", () => {
    expect(clampLoad(1, 5000, 5000)).toEqual({ from: 1, count: 250 });
  });

  it("turns nonsense into one flyer from the start", () => {
    expect(clampLoad(Number.NaN, Number.NaN, 522)).toEqual({ from: 1, count: 1 });
    expect(clampLoad(-4, 0, 522)).toEqual({ from: 1, count: 1 });
  });
});

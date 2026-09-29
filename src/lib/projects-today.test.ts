import { describe, expect, it } from "vitest";

import { projectStage, stepState, type AreaProgress, type StageInput } from "./projects-today";

const area = (name: string, extra: Partial<AreaProgress> = {}): AreaProgress => ({ name, location: null, prepped: false, done: false, working: false, ...extra });
const day = (extra: Partial<StageInput> = {}): StageInput => ({
  meetOnSite: false,
  atShopAt: null,
  loadedAt: null,
  leftShopAt: null,
  arrivedAt: null,
  areas: [area("Zone 1"), area("Zone 2")],
  walkthroughAskedAt: null,
  ...extra,
});

describe("where a project out today has got to", () => {
  it("follows the crew from the shop to the house", () => {
    expect(projectStage(day()).step).toBe(-1);
    expect(projectStage(day({ atShopAt: "7:00" }))).toMatchObject({ step: 1, now: "At the shop, loading the tools" });
    expect(projectStage(day({ atShopAt: "7:00", loadedAt: "7:40" })).step).toBe(2);
    expect(projectStage(day({ atShopAt: "7:00", loadedAt: "7:40", leftShopAt: "7:45" }))).toMatchObject({ step: 3, now: "On the way" });
  });

  it("names the area being prepped, then the area being worked", () => {
    const prepping = projectStage(day({ arrivedAt: "8:30", areas: [area("Zone 1", { prepped: true }), area("Zone 2", { working: true, location: "Left side" })] }));
    expect(prepping).toMatchObject({ step: 4, now: "Prepping Zone 2 (2 of 2), left side" });
    const working = projectStage(day({ arrivedAt: "8:30", areas: [area("Zone 1", { prepped: true, done: true }), area("Zone 2", { prepped: true, working: true })] }));
    expect(working).toMatchObject({ step: 5, now: "Installing Zone 2 (2 of 2)", areasDone: 1, areasTotal: 2 });
  });

  it("is at the walkthrough once every area is done, or it was asked for", () => {
    const done = [area("Zone 1", { prepped: true, done: true }), area("Zone 2", { prepped: true, done: true })];
    expect(projectStage(day({ arrivedAt: "8:30", areas: done })).step).toBe(6);
    expect(projectStage(day({ arrivedAt: "8:30", areas: done, walkthroughAskedAt: "2:15" }))).toMatchObject({ step: 6, now: "Every area done. Asked you to walk it" });
  });

  it("skips the shop for a crew meeting on site", () => {
    expect(projectStage(day({ meetOnSite: true })).step).toBe(3);
    expect(projectStage(day({ meetOnSite: true, arrivedAt: "8:00" })).step).toBe(4);
  });

  it("colours the bar", () => {
    expect([0, 1, 2].map((i) => stepState(i, 1))).toEqual(["done", "now", "todo"]);
  });
});

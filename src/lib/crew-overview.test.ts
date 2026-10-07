import { describe, expect, it } from "vitest";

import { getsSodOrSeedAfter, isKeepLine, mapColorByZone, planCrewStages, stageForType, type OverviewZone } from "./crew-overview";

function zone(typeId: string, at: [number, number], values: Record<string, string> = {}, notes = ""): OverviewZone {
  const [x, y] = at;
  return { typeId, values, notes, points: [{ x, y }, { x: x + 10, y }, { x: x + 10, y: y + 10 }] };
}

describe("planCrewStages", () => {
  it("clears before it trims, and trims before the beds", () => {
    const stages = planCrewStages([
      zone("landscape-bed", [0, 0]),
      zone("trimming", [50, 0]),
      zone("landscape-cleanup", [100, 0]),
    ]);
    expect(stages.map((s) => s.key)).toEqual(["clear", "trim", "beds"]);
    expect(stages.map((s) => s.zones)).toEqual([[2], [1], [0]]);
  });

  it("lays sod last on ground the job clears", () => {
    const stages = planCrewStages([
      zone("plant-bush-removal", [0, 0], { afterward: "Other", afterward__other: "Sod installation" }),
      zone("landscape-cleanup", [0, 20], {}, "Mint plant is staying. Sod will be installed in this area"),
      zone("trimming", [0, 40]),
    ]);
    expect(stages.map((s) => s.key)).toEqual(["clear", "trim", "finish"]);
    expect(stages.at(-1)!.zones).toEqual([0, 1]);
    expect(stages.at(-1)!.finish).toEqual({ 0: "sod", 1: "sod" });
  });

  it("works each stage nearest-first", () => {
    const stages = planCrewStages([
      zone("trimming", [0, 0]),
      zone("trimming", [500, 0]),
      zone("trimming", [20, 0]),
    ]);
    expect(stages[0].zones).toEqual([0, 2, 1]);
  });

  it("puts a service it doesn't know in other work, not nowhere", () => {
    expect(stageForType("custom-488c16d9")).toBe("other");
    expect(planCrewStages([zone("custom-488c16d9", [0, 0])])[0].zones).toEqual([0]);
  });
});

describe("getsSodOrSeedAfter", () => {
  it("is only for clearing work", () => {
    expect(getsSodOrSeedAfter(zone("lawn-restoration", [0, 0], {}, "new sod"))).toBeNull();
    expect(getsSodOrSeedAfter(zone("plant-bush-removal", [0, 0], { afterward: "Return to Lawn" }))).toBe("seed");
    expect(getsSodOrSeedAfter(zone("landscape-cleanup", [0, 0], {}, "sodium lights by the gate"))).toBeNull();
  });
});

describe("mapColorByZone", () => {
  it("colours an area by the first stage it is in", () => {
    const stages = planCrewStages([zone("plant-bush-removal", [0, 0], { afterward: "Sod installation" })]);
    expect(mapColorByZone(stages, 1)).toEqual([stages[0].color]);
  });
});

describe("isKeepLine", () => {
  it("picks out what to leave alone", () => {
    expect(isKeepLine("Leave these where they are: the tree and hostas.")).toBe(true);
    expect(isKeepLine("Trim the 5 bushes.")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { groupByStage } from "./pipeline-stages";

describe("groupByStage", () => {
  it("keeps the pipeline order and drops empty stages", () => {
    const groups = groupByStage(
      [
        { id: 1, stage: "closed" },
        { id: 2, stage: "booked" },
        { id: 3, stage: "closed" },
      ],
      (l) => l.stage,
      ["booked", "visited", "closed"] as const
    );
    expect(groups.map((g) => [g.stage, g.lines.map((l) => l.id)])).toEqual([
      ["booked", [2]],
      ["closed", [1, 3]],
    ]);
  });

  it("keeps a stage the order did not name, last", () => {
    const groups = groupByStage([{ stage: "odd" }, { stage: "a" }], (l) => l.stage, ["a"]);
    expect(groups.map((g) => g.stage)).toEqual(["a", "odd"]);
  });
});

import { describe, expect, it } from "vitest";

import { angleLine, zoneProgress } from "./guided-zones";

const zones = [
  { id: "a", name: "Zone 1" },
  { id: "b", name: "Zone 2" },
  { id: "c", name: "Zone 3" },
];

describe("zoneProgress", () => {
  it("starts at the first area with no after photo", () => {
    const p = zoneProgress(zones, [{ zoneId: "a", kind: "before" }]);
    expect(p.current?.id).toBe("a");
    expect(p.position).toBe(1);
    expect(p.done).toEqual([]);
  });
  it("moves on only when the area has an after photo, and skips ahead past done ones", () => {
    const p = zoneProgress(zones, [
      { zoneId: "a", kind: "after" },
      { zoneId: "b", kind: "during" },
    ]);
    expect(p.done).toEqual(["a"]);
    expect(p.current?.id).toBe("b");
    expect(p.position).toBe(2);
  });
  it("is finished when every area has one", () => {
    const p = zoneProgress(zones, zones.map((z) => ({ zoneId: z.id, kind: "after" })));
    expect(p.current).toBeNull();
    expect(p.done).toHaveLength(3);
  });
});

describe("angleLine", () => {
  it("asks for the evaluation's angle when there is one to match", () => {
    expect(angleLine(0)).toContain("whole area");
    expect(angleLine(1)).toContain("match its angle");
    expect(angleLine(3)).toContain("first one");
  });
});

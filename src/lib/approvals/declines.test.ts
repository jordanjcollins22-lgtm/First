import { describe, expect, it } from "vitest";

import { declineRateLine, isDeclineReason, topDeclineReasons } from "./declines";

describe("topDeclineReasons", () => {
  it("counts reasons, most common first, with the kinds behind each", () => {
    const top = topDeclineReasons([
      { reason: "timing", itemType: "email", itemKind: "evaluation_after" },
      { reason: "timing", itemType: "email", itemKind: "evaluation_after" },
      { reason: "timing", itemType: "email", itemKind: "proposal_follow_up" },
      { reason: "wording", itemType: "email", itemKind: "evaluation_booked" },
      { reason: "nonsense", itemType: "play", itemKind: null },
    ]);
    expect(top.map((r) => [r.reason, r.count])).toEqual([
      ["timing", 3],
      ["wording", 1],
      ["other", 1],
    ]);
    expect(top[0].kinds).toEqual([
      { kind: "evaluation_after", count: 2 },
      { kind: "proposal_follow_up", count: 1 },
    ]);
    expect(top[2].kinds).toEqual([{ kind: "play", count: 1 }]);
  });

  it("is empty with nothing declined, and limits its length", () => {
    expect(topDeclineReasons([])).toEqual([]);
    const many = ["wrong_person", "cancelled_booking", "wording", "timing", "other"].map((reason) => ({ reason, itemType: "email", itemKind: "x" }));
    expect(topDeclineReasons(many, 2)).toHaveLength(2);
  });
});

describe("declineRateLine", () => {
  it("says the share, or nothing with nothing decided", () => {
    expect(declineRateLine(51, 128)).toBe("51 of 128 declined (40%)");
    expect(declineRateLine(0, 0)).toBeNull();
  });
  it("knows its reasons", () => {
    expect(isDeclineReason("cancelled_booking")).toBe(true);
    expect(isDeclineReason("because")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { describePlayTrust, learnedQuantity, learnedReach, playPolicy, playStreak, type PlayReview } from "./marketing-approval";
import type { MarketingPlay } from "./marketing-plays";

function review(over: Partial<PlayReview>): PlayReview {
  return { playId: "p", kind: "door_hangers", reason: "client", decision: "approve", quantityBefore: 100, quantityAfter: 100, removedCount: 0, keptMaxM: 300, removedMinM: null, at: "2026-09-06T10:00:00Z", ...over };
}
const play = { id: "p", kind: "door_hangers", quantity: 100, reason: "client" } as MarketingPlay;

describe("learning from decisions", () => {
  it("counts approvals of a kind in a row, and a change resets it", () => {
    expect(playStreak([review({}), review({ kind: "knocks", decision: "edit" }), review({}), review({ decision: "edit" }), review({})], "door_hangers")).toBe(2);
    expect(playStreak([review({ decision: "auto" })], "door_hangers")).toBe(0);
  });
  it("learns the count the business settles on, once there is enough to go on", () => {
    expect(learnedQuantity([review({ quantityAfter: 80 }), review({ quantityAfter: 80 })], "door_hangers")).toBe(100);
    expect(learnedQuantity([review({ quantityAfter: 80 }), review({ quantityAfter: 75 }), review({ quantityAfter: 90 })], "door_hangers")).toBe(80);
    expect(learnedQuantity([], "flyers")).toBe(1000);
  });
  it("learns how far a hanger is worth carrying from edits that trimmed the far doors", () => {
    const trims = [1, 2, 3].map(() => review({ decision: "edit", removedCount: 8, keptMaxM: 250, removedMinM: 260 }));
    expect(learnedReach(trims)).toBe(275);
    expect(learnedReach([...trims.slice(0, 2), review({ decision: "edit", removedCount: 2, keptMaxM: 300, removedMinM: 50 })])).toBeNull();
  });
  it("asks until ten untouched, then approves plays that match what it learned", () => {
    const ten = Array.from({ length: 10 }, () => review({}));
    expect(playPolicy(play, ten.slice(0, 9)).decision).toBe("ask");
    expect(playPolicy(play, ten)).toEqual({ decision: "auto", why: "like the door hangers plays already approved" });
    expect(playPolicy({ ...play, quantity: 60 }, ten).why).toMatch(/60 where 100 is usual/);
    expect(describePlayTrust(ten)).toMatch(/door hangers: approved on their own now/);
    expect(describePlayTrust([review({ quantityAfter: 80 }), review({ quantityAfter: 80 }), review({ quantityAfter: 80 })])).toMatch(/Learned: 80 hangers a play/);
  });
});

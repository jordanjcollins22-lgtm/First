import { describe, expect, it } from "vitest";

import { nextRound, reviewBlocker, reviewsFor, zonesNeedingDraft, type ScopeRecommendation } from "./scope-review";

function rec(over: Partial<ScopeRecommendation>): ScopeRecommendation {
  return {
    id: Math.random().toString(36).slice(2),
    jobId: "j",
    zoneIndex: 0,
    zoneName: "Front bed",
    round: 1,
    evaluatorNote: "dog dug up mulch, wants it redone",
    recommendedText: "Rake out and replace the mulch across the front bed.",
    status: "pending",
    declineReason: null,
    decidedAt: null,
    createdAt: "2026-09-16T12:00:00Z",
    ...over,
  };
}

const zones = [
  { zoneIndex: 0, zoneName: "Front bed", note: "dog dug up mulch, wants it redone" },
  { zoneIndex: 1, zoneName: "Back lawn", note: "" },
  { zoneIndex: 2, zoneName: "Side", note: "trim anything drooping" },
];

describe("reviewsFor", () => {
  it("only reviews zones the evaluator wrote on", () => {
    expect(reviewsFor(zones, []).map((r) => r.zoneName)).toEqual(["Front bed", "Side"]);
  });

  it("is settled once the latest round is approved for the note as written", () => {
    const reviews = reviewsFor(zones, [rec({ status: "approved" })]);
    expect(reviews[0].settled).toBe(true);
    expect(reviews[1].settled).toBe(false);
  });

  it("unsettles when the evaluator's note changes after approval", () => {
    const reviews = reviewsFor(zones, [rec({ status: "approved", evaluatorNote: "an older note" })]);
    expect(reviews[0].settled).toBe(false);
    expect(reviews[0].noteChanged).toBe(true);
  });

  it("keeps the earlier rounds as history, newest current", () => {
    const reviews = reviewsFor(zones, [rec({ round: 1, status: "declined", declineReason: "too vague" }), rec({ round: 2 })]);
    expect(reviews[0].current?.round).toBe(2);
    expect(reviews[0].history.map((r) => r.round)).toEqual([1]);
  });
});

describe("what still needs writing and what blocks approval", () => {
  it("wants a draft where there is none, where the note moved, or after a decline", () => {
    const reviews = reviewsFor(zones, [rec({ zoneIndex: 0, status: "declined" })]);
    expect(zonesNeedingDraft(reviews).map((r) => r.zoneName)).toEqual(["Front bed", "Side"]);
  });

  it("names the zones holding the proposal up", () => {
    expect(reviewBlocker(reviewsFor(zones, [rec({ status: "approved" })]))).toBe("Approve or decline the recommended scope for Side first.");
    expect(reviewBlocker(reviewsFor(zones, []))).toBe("Approve or decline the recommended scope for Front bed and Side first.");
    expect(reviewBlocker(reviewsFor(zones, [rec({ zoneIndex: 0, status: "approved" }), rec({ zoneIndex: 2, zoneName: "Side", evaluatorNote: "trim anything drooping", status: "approved" })]))).toBeNull();
  });

  it("numbers the next round", () => {
    expect(nextRound([rec({ round: 1 }), rec({ round: 2 })], 0)).toBe(3);
    expect(nextRound([], 4)).toBe(1);
  });
});

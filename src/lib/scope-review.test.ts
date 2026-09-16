import { describe, expect, it } from "vitest";

import {
  dictatedWording,
  groupReviews,
  keepWordingAsTyped,
  nextOpenGroup,
  nextRound,
  reviewBlocker,
  reviewsFor,
  zoneListLabel,
  zonesNeedingDraft,
  type ScopeRecommendation,
} from "./scope-review";

function rec(over: Partial<ScopeRecommendation>): ScopeRecommendation {
  return {
    id: Math.random().toString(36).slice(2),
    jobId: "j",
    zoneIndex: 0,
    zoneName: "Front bed",
    round: 1,
    evaluatorNote: "dog dug up mulch, wants it redone",
    serviceLabel: "Landscape Bed",
    recommendedText: "Rake out and replace the mulch across the front bed.",
    status: "pending",
    declineReason: null,
    decidedAt: null,
    createdAt: "2026-09-16T12:00:00Z",
    ...over,
  };
}

const zones = [
  { zoneIndex: 0, zoneName: "Front bed", note: "dog dug up mulch, wants it redone", serviceLabel: "Landscape Bed" },
  { zoneIndex: 1, zoneName: "Back lawn", note: "", serviceLabel: "Lawn Care" },
  { zoneIndex: 2, zoneName: "Side", note: "trim anything drooping", serviceLabel: "Trimming" },
];

describe("reviewsFor", () => {
  it("reviews every zone with a service, note or no note", () => {
    expect(reviewsFor(zones, []).map((r) => r.zoneName)).toEqual(["Front bed", "Back lawn", "Side"]);
  });

  it("goes stale when the zone's service changes, whatever the note says", () => {
    const [front] = reviewsFor(zones, [rec({ status: "approved", serviceLabel: "Leaf / Seasonal Cleanup" })]);
    expect(front.settled).toBe(false);
    expect(front.changedWhy).toBe("the service changed to Landscape Bed");
  });

  it("is settled once the latest round is approved for the note as written", () => {
    const reviews = reviewsFor(zones, [rec({ status: "approved" })]);
    expect(reviews[0].settled).toBe(true);
    expect(reviews[1].settled).toBe(false);
  });

  it("unsettles when the evaluator's note changes after approval", () => {
    const reviews = reviewsFor(zones, [rec({ status: "approved", evaluatorNote: "an older note" })]);
    expect(reviews[0].settled).toBe(false);
    expect(reviews[0].changed).toBe(true);
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
    expect(zonesNeedingDraft(reviews).map((r) => r.zoneName)).toEqual(["Front bed", "Back lawn", "Side"]);
  });

  it("names the zones holding the proposal up", () => {
    const lawn = rec({ zoneIndex: 1, zoneName: "Back lawn", evaluatorNote: "", serviceLabel: "Lawn Care", status: "approved" });
    expect(reviewBlocker(reviewsFor(zones, [rec({ status: "approved" }), lawn]))).toBe("Approve or decline the recommended scope for Side first.");
    expect(reviewBlocker(reviewsFor(zones, []))).toBe("Approve or decline the recommended scope for Front bed, Back lawn and Side first.");
    expect(
      reviewBlocker(
        reviewsFor(zones, [
          rec({ zoneIndex: 0, status: "approved" }),
          lawn,
          rec({ zoneIndex: 2, zoneName: "Side", evaluatorNote: "trim anything drooping", serviceLabel: "Trimming", status: "approved" }),
        ])
      )
    ).toBeNull();
  });

  it("numbers the next round", () => {
    expect(nextRound([rec({ round: 1 }), rec({ round: 2 })], 0)).toBe(3);
    expect(nextRound([], 4)).toBe(1);
  });
});

describe("dictatedWording", () => {
  it("takes the words after a cue, exactly as typed", () => {
    const reason =
      "This is how i would like it to be written, Trim and maintain the three large hedges located along the left side of the property. Hedges will be trimmed every two weeks to maintain a neat, controlled appearance.";
    expect(dictatedWording(reason)).toBe(
      "Trim and maintain the three large hedges located along the left side of the property. Hedges will be trimmed every two weeks to maintain a neat, controlled appearance."
    );
    expect(dictatedWording('Write it like this: "We will trim the hedges every two weeks."')).toBe("We will trim the hedges every two weeks.");
  });

  it("treats a full scope with no cue as the wording", () => {
    expect(dictatedWording("Trim the three hedges along the left side every two weeks while the client is deployed. The client will do the first cut before leaving.")).not.toBeNull();
  });

  it("leaves a remark to the rewriter", () => {
    expect(dictatedWording("too vague, mention every two weeks")).toBeNull();
    expect(dictatedWording("Client plans to complete the initial hedge trimming prior to deployment.")).toBeNull();
    expect(dictatedWording("Don't promise the edging. Keep it to the hedges.")).toBeNull();
  });

  it("keeps typed wording as typed, bar the dashes", () => {
    expect(keepWordingAsTyped("Trim the hedges — every two weeks.")).toBe("Trim the hedges, every two weeks.");
  });
});

describe("grouping zones that say the same thing", () => {
  const lawns = [
    { zoneIndex: 0, zoneName: "Zone 1", note: "", serviceLabel: "Lawn Care" },
    { zoneIndex: 1, zoneName: "Zone 2", note: "", serviceLabel: "Lawn Care" },
    { zoneIndex: 2, zoneName: "Zone 3", note: "dog spots", serviceLabel: "Lawn Care" },
    { zoneIndex: 3, zoneName: "Zone 4", note: "", serviceLabel: "Trimming" },
  ];
  const same = "Mow, edge and blow off every visit.";

  it("puts identical service and wording together, and the rest on their own", () => {
    const groups = groupReviews(
      reviewsFor(lawns, [
        rec({ zoneIndex: 0, zoneName: "Zone 1", evaluatorNote: "", serviceLabel: "Lawn Care", recommendedText: same }),
        rec({ zoneIndex: 1, zoneName: "Zone 2", evaluatorNote: "", serviceLabel: "Lawn Care", recommendedText: same }),
        rec({ zoneIndex: 2, zoneName: "Zone 3", evaluatorNote: "dog spots", serviceLabel: "Lawn Care", recommendedText: "Mow, and treat the dog spots." }),
        rec({ zoneIndex: 3, zoneName: "Zone 4", evaluatorNote: "", serviceLabel: "Trimming", recommendedText: same }),
      ])
    );
    expect(groups.map((g) => g.zones.map((z) => z.zoneName))).toEqual([["Zone 1", "Zone 2"], ["Zone 3"], ["Zone 4"]]);
    expect(groups[0].text).toBe(same);
  });

  it("shows the first open group next, and none once all are settled", () => {
    const groups = groupReviews(
      reviewsFor(lawns.slice(0, 2), [
        rec({ zoneIndex: 0, zoneName: "Zone 1", evaluatorNote: "", serviceLabel: "Lawn Care", recommendedText: same, status: "approved" }),
        rec({ zoneIndex: 1, zoneName: "Zone 2", evaluatorNote: "", serviceLabel: "Lawn Care", recommendedText: same, status: "approved" }),
      ])
    );
    expect(nextOpenGroup(groups)).toBeNull();
    expect(nextOpenGroup(groupReviews(reviewsFor(lawns.slice(0, 2), [])))?.zones[0].zoneName).toBe("Zone 1");
  });

  it("names zones the way a person would", () => {
    expect(zoneListLabel([{ zoneName: "Zone 3" }])).toBe("Zone 3");
    expect(zoneListLabel([{ zoneName: "Zone 8" }, { zoneName: "Zone 9" }, { zoneName: "Zone 10" }])).toBe("Zone 8, Zone 9 and Zone 10");
  });
});

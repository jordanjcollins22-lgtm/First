import { describe, expect, it } from "vitest";

import { scoreProject, type ProjectReviewInput } from "./project-review";

const base: ProjectReviewInput = {
  priceCents: 110_000,
  budget: { crewHours: 10, labourCents: 30_000, materialsCents: 10_000 },
  realCrewHours: 9,
  crewRateCents: 3000,
  receiptsCents: 0,
  feePct: 15,
  issues: [],
  fiveStar: { value: true, how: "marked", note: null },
  referred: ["Sam Sample"],
};

describe("the project review", () => {
  it("is all green when every number is good", () => {
    const r = scoreProject(base);
    expect(r.allGood).toBe(true);
    expect(r.hours.value).toBe("10/9");
    expect(r.cost.value).toBe("$400/$370");
    // $1,100 less $370 and the $165 fee.
    expect(r.profit.value).toBe("51%");
  });

  it("is red on any issue at all, and says what is left to do about it", () => {
    const r = scoreProject({
      ...base,
      issues: [
        { id: "1", kind: "issue", title: "Mulch short", open: true, resolution: null, prevention: null, createdAt: "" },
        { id: "2", kind: "ticket", title: "Edge missed", open: false, resolution: "Went back", prevention: null, createdAt: "" },
      ],
    });
    expect(r.issues.good).toBe(false);
    expect(r.issues.value).toBe("2");
    expect(r.issues.detail).toBe("1 still open, 1 with nothing to stop it happening again");
  });

  it("is red over the hours or the cost, and under 50% profit", () => {
    const r = scoreProject({ ...base, realCrewHours: 14, receiptsCents: 5000 });
    expect(r.hours.good).toBe(false);
    expect(r.hours.detail).toBe("4 hrs over");
    expect(r.cost.good).toBe(false);
    expect(r.profit.good).toBe(false);
  });

  it("is red with no review, no referral, and no budget", () => {
    const r = scoreProject({ ...base, budget: null, fiveStar: { value: null, how: null, note: null }, referred: [] });
    expect(r.review.value).toBe("N");
    expect(r.referral.value).toBe("N");
    expect(r.hours.good).toBe(false);
    expect(r.cost.good).toBe(false);
  });

  it("is scored on the real cost entered at the final sign-off", () => {
    const r = scoreProject({ ...base, realCrewHours: 0, final: { crewHours: 11, materialsCents: 12_000, otherCents: 2_500 } });
    expect(r.hours.value).toBe("10/11");
    expect(r.hours.good).toBe(false);
    // 11 hours at $30, $120 of materials, $25 else.
    expect(r.cost.realCents).toBe(33_000 + 12_000 + 2_500);
  });
});

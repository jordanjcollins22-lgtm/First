import { describe, expect, it } from "vitest";

import { bottleneck, cashProfit, evaluationsShort, growthKpis, type GrowthInput } from "./growth";

const healthy: GrowthInput = {
  cash: 40_000,
  cashFloor: 20_000,
  moneyIn: 90_000,
  moneyOut: 70_000,
  windowWeeks: 12,
  evaluationsPerWeek: 6,
  evaluationsTargetPerWeek: 6,
  weeksBooked: 4,
  weeksBookedTarget: 3,
  ownerHoursLastWeek: 3,
  ownerHoursTarget: 5,
  ownerTouchesLastWeek: 2,
  ownerTopCategory: null,
  crewsStopped: 0,
  changesAwaitingReview: 0,
};

const g = (over: Partial<GrowthInput> = {}): GrowthInput => ({ ...healthy, ...over });

describe("five numbers, and only five", () => {
  it("is five, in a fixed order", () => {
    const kpis = growthKpis(healthy);
    expect(kpis).toHaveLength(5);
    expect(kpis.map((k) => k.key)).toEqual(["cash", "profit", "evaluations", "booked", "owner-hours"]);
  });

  it("gives every one a line saying what it is measured against", () => {
    for (const kpi of growthKpis(healthy)) {
      expect(kpi.says.length, `${kpi.key} says nothing`).toBeGreaterThan(0);
      expect(kpi.value.length).toBeGreaterThan(0);
    }
  });

  it("says cash is not known rather than showing a zero", () => {
    const cash = growthKpis(g({ cash: null }))[0];
    expect(cash.value).toBe("Not known");
    expect(cash.tone).toBe("unknown");
  });

  it("never shows unlogged owner hours as zero", () => {
    // A fabricated zero would make the graph go the right way for the wrong
    // reason, which is the worst available outcome for this number.
    const hours = growthKpis(g({ ownerHoursLastWeek: null, ownerTouchesLastWeek: 9 }))[4];
    expect(hours.value).toBe("Not logged");
    expect(hours.tone).toBe("unknown");
    expect(hours.says).toContain("9 decisions last week that only you could make");
  });

  it("says so plainly when nothing came to the owner at all", () => {
    const hours = growthKpis(g({ ownerHoursLastWeek: null, ownerTouchesLastWeek: 0 }))[4];
    expect(hours.says).toBe("Nothing logged, and no decisions came to you last week.");
  });

  it("names where the hours went when it knows", () => {
    const hours = growthKpis(g({ ownerHoursLastWeek: 11, ownerTopCategory: "rescheduling" }))[4];
    expect(hours.says).toContain("6.0 over the 5 you wanted");
    expect(hours.says).toContain("moving work around");
    expect(hours.tone).toBe("bad");
  });

  it("counts evaluations needed as a gap, never as a negative", () => {
    expect(evaluationsShort({ evaluationsPerWeek: 8, evaluationsTargetPerWeek: 6 })).toBe(0);
    expect(evaluationsShort({ evaluationsPerWeek: 2, evaluationsTargetPerWeek: 6 })).toBe(4);
    expect(growthKpis(g({ evaluationsPerWeek: 8 }))[2].value).toBe("None");
  });

  it("measures profit as the money that actually moved", () => {
    expect(cashProfit({ moneyIn: 90_000, moneyOut: 70_000 })).toBe(20_000);
    expect(growthKpis(healthy)[1].says).toContain("last 12 weeks");
  });
});

describe("one bottleneck, chosen by rule", () => {
  it("says nothing is in the way when nothing is", () => {
    const b = bottleneck(healthy);
    expect(b.key).toBe("none");
    expect(b.fix).toBeNull();
  });

  it("puts cash under the floor above everything else", () => {
    const b = bottleneck(g({ cash: 5_000, crewsStopped: 2, weeksBooked: 0, ownerHoursLastWeek: 40 }));
    expect(b.key).toBe("cash-below-floor");
    expect(b.says).toBe("Cash is the constraint: $5,000 against a floor of $20,000.");
  });

  it("puts a stopped crew above everything except cash", () => {
    const b = bottleneck(g({ crewsStopped: 1, weeksBooked: 0, ownerHoursLastWeek: 40 }));
    expect(b.key).toBe("crew-stopped");
    expect(b.fix?.href).toBe("/jobs?tab=attention");
  });

  it("notices spending more than earning", () => {
    const b = bottleneck(g({ moneyIn: 50_000, moneyOut: 70_000 }));
    expect(b.key).toBe("spending-more-than-earning");
    expect(b.says).toContain("$20,000 down over 12 weeks");
  });

  it("calls out an empty book before an empty diary", () => {
    // Sold work has the longest lead time: by the time it hurts, fixing it
    // takes two months.
    const b = bottleneck(g({ weeksBooked: 0.5, evaluationsPerWeek: 1 }));
    expect(b.key).toBe("not-enough-booked");
  });

  it("falls through to evaluations once the book is respectable", () => {
    const b = bottleneck(g({ weeksBooked: 2.5, evaluationsPerWeek: 2 }));
    expect(b.key).toBe("not-enough-evaluations");
    expect(b.says).toBe("You need 4.0 more evaluations a week to keep the crew fed.");
  });

  it("tells the owner they are the constraint when they are", () => {
    const b = bottleneck(g({ ownerHoursLastWeek: 18, ownerTopCategory: "chasing_payment" }));
    expect(b.key).toBe("owner-is-the-bottleneck");
    expect(b.says).toBe("You are the constraint: 13.0 hours over what you wanted, mostly chasing payment.");
  });

  it("does not accuse an owner who logged nothing", () => {
    // Unknown is not "fine" and it is not "bad" either. It cannot be the
    // bottleneck, because nothing measured it.
    const b = bottleneck(g({ ownerHoursLastWeek: null, ownerTouchesLastWeek: 30 }));
    expect(b.key).toBe("none");
  });

  it("picks up decisions queueing when everything else is healthy", () => {
    const b = bottleneck(g({ changesAwaitingReview: 3 }));
    expect(b.key).toBe("decisions-queueing");
    expect(b.says).toBe("3 change requests are sitting unanswered.");
  });

  it("gives exactly one place to go, never a list", () => {
    for (const input of [
      g({ cash: 1 }),
      g({ crewsStopped: 1 }),
      g({ moneyOut: 200_000 }),
      g({ weeksBooked: 0 }),
      g({ evaluationsPerWeek: 1, weeksBooked: 3 }),
      g({ ownerHoursLastWeek: 20 }),
      g({ changesAwaitingReview: 1 }),
    ]) {
      const b = bottleneck(input);
      expect(b.fix, `${b.key} has nowhere to go`).not.toBeNull();
      expect(b.says.split(". ").filter(Boolean).length).toBeLessThanOrEqual(2);
    }
  });
});

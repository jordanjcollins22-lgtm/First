import { describe, expect, it } from "vitest";

import { summarizeRun, type RunInput } from "@/lib/test-runs";

const base: RunInput = {
  jobId: "j1",
  jobNumber: 12,
  createdAt: "2026-11-01T14:00:00.000Z",
  customer: { name: "Sam Tester", email: "sam@example.com", phone: "443-555-0101" },
  address: "1 Main St, Bel Air, MD",
  token: "0123456789abcdef01234567",
  photoFlag: null,
  estimate: null,
  steps: [],
};

const estimate = (over: Partial<NonNullable<RunInput["estimate"]>> = {}): NonNullable<RunInput["estimate"]> => ({
  spots: [{ lng: 0, lat: 0, choices: ["mulch", "weeds"], photos: [], here: "dirt", wants: ["mulch"] }],
  sizing: [{ index: 0, choices: ["mulch", "weeds"], areaSqft: 240, count: null, source: "traced", confidence: "high", from: "Traced", priceCents: 80000 }],
  totalCents: 110000,
  depositCents: 36700,
  choice: null,
  tierName: null,
  chargedCents: null,
  startDay: null,
  testVisitAt: null,
  createdAt: "2026-11-01T14:06:00.000Z",
  updatedAt: "2026-11-01T14:06:00.000Z",
  ...over,
});

describe("summarizeRun", () => {
  it("stops at their details when they never opened the map", () => {
    const run = summarizeRun(base);
    expect(run.stage).toBe(1);
    expect(run.stageLabel).toBe("Gave their details");
    expect(run.spots).toEqual([]);
    expect(run.totalCents).toBeNull();
  });

  it("counts opening the map", () => {
    expect(summarizeRun({ ...base, steps: [{ step: "map_opened", at: "2026-11-01T14:01:00.000Z" }] }).stage).toBe(2);
  });

  it("lists the spots with what they said and how each was sized", () => {
    const run = summarizeRun({ ...base, estimate: estimate() });
    expect(run.stage).toBe(3);
    expect(run.spots).toEqual([
      { number: 1, asked: "Dirt or weeds → A mulch bed", size: "About 240 sq ft", sizedBy: "traced by them", priceCents: 80000 },
    ]);
    expect(run.totalCents).toBe(110000);
    expect(run.minutes).toBe(6);
  });

  it("says what they chose and the day they picked", () => {
    const deposit = summarizeRun({ ...base, estimate: estimate({ choice: "deposit", chargedCents: 36700, startDay: "2026-11-04" }) });
    expect(deposit.stage).toBe(5);
    expect(deposit.chose).toBe("Deposit, $367");
    expect(deposit.picked).toBe("Start Wednesday, Nov 4");

    const evaluation = summarizeRun({
      ...base,
      estimate: estimate({ choice: "evaluation", tierName: "Measured plan", chargedCents: 19900, testVisitAt: "2026-11-04T15:00:00.000Z" }),
    });
    expect(evaluation.chose).toBe("Measured plan, $199");
    expect(evaluation.picked).toBe("Evaluation Wednesday, Nov 4, 10:00 AM");
  });

  it("reads a spot from before the two questions by its choices", () => {
    const run = summarizeRun({ ...base, estimate: estimate({ spots: [{ lng: 0, lat: 0, choices: ["trim"], photos: [] }], sizing: [] }) });
    expect(run.spots[0]).toMatchObject({ asked: "Trim bushes", size: null, priceCents: null });
  });
});

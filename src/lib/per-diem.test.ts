import { describe, expect, it } from "vitest";

import {
  DEFAULT_PATTERN,
  daysForJob,
  flatOverheadFor,
  overheadForJob,
  perDiemFrom,
  perDiemLines,
  type WorkingPattern,
} from "@/lib/per-diem";

/** What the bank says it costs to keep the doors open. */
const MONTHLY = 4_559.83;

describe("perDiemFrom", () => {
  it("spreads the month across the days somebody is actually earning", () => {
    const perDiem = perDiemFrom(MONTHLY, DEFAULT_PATTERN);
    // 4,559.83 over eighteen days.
    expect(perDiem.perDay).toBe(253.32);
    expect(perDiem.perMonth).toBe(4_559.83);
    expect(perDiem.perYear).toBe(54_717.96);
  });

  it("charges a full crew for a full day exactly one per diem", () => {
    const perDiem = perDiemFrom(MONTHLY, DEFAULT_PATTERN);
    const oneDay = DEFAULT_PATTERN.hoursPerDay * DEFAULT_PATTERN.crewSize;
    expect(overheadForJob(oneDay, perDiem)).toBeCloseTo(perDiem.perDay, 1);
  });

  it("does not charge a bigger crew more overhead for the same day", () => {
    const two = perDiemFrom(MONTHLY, DEFAULT_PATTERN);
    const three = perDiemFrom(MONTHLY, { ...DEFAULT_PATTERN, crewSize: 3 });
    // Three people for a day is 24 crew-hours at the three-crew rate; two
    // people for a day is 16 at the two-crew rate. The rent is the same.
    // Within a penny or so of each other: the per-crew-hour rate is rounded
    // to cents, and a day is sixteen or twenty-four of them.
    expect(overheadForJob(24, three)).toBeCloseTo(overheadForJob(16, two), 0);
  });

  it("counts fewer billable days as a higher per diem", () => {
    const optimistic = perDiemFrom(MONTHLY, { ...DEFAULT_PATTERN, billableDaysPerMonth: 22 });
    const honest = perDiemFrom(MONTHLY, { ...DEFAULT_PATTERN, billableDaysPerMonth: 14 });
    expect(honest.perDay).toBeGreaterThan(optimistic.perDay);
  });

  it("returns zeroes rather than dividing by nothing", () => {
    const nobody: WorkingPattern = { billableDaysPerMonth: 0, hoursPerDay: 8, crewSize: 2 };
    const perDiem = perDiemFrom(MONTHLY, nobody);
    expect(perDiem.perDay).toBe(0);
    expect(perDiem.perCrewHour).toBe(0);
    expect(Number.isFinite(perDiem.perCrewHour)).toBe(true);
    // The monthly figure is still true, and is the only honest thing to show.
    expect(perDiem.perMonth).toBe(4_559.83);
  });

  it("survives a crew of nobody the same way", () => {
    const perDiem = perDiemFrom(MONTHLY, { ...DEFAULT_PATTERN, crewSize: 0 });
    expect(perDiem.perCrewHour).toBe(0);
    expect(perDiem.crewHoursPerMonth).toBe(0);
  });
});

describe("perDiemLines", () => {
  const groups = [
    { label: "Premises", monthly: 2_543.89 },
    { label: "Software and subscriptions", monthly: 792.89 },
    { label: "Insurance", monthly: 453.85 },
  ];

  it("puts the biggest daily cost first, whatever order it came in", () => {
    const lines = perDiemLines([groups[2], groups[0], groups[1]], DEFAULT_PATTERN);
    expect(lines.map((line) => line.label)).toEqual([
      "Premises",
      "Software and subscriptions",
      "Insurance",
    ]);
  });

  it("says what each line costs a day", () => {
    const [premises] = perDiemLines(groups, DEFAULT_PATTERN);
    expect(premises.perDay).toBe(141.33);
  });

  it("shares add up to the whole", () => {
    const lines = perDiemLines(groups, DEFAULT_PATTERN);
    const total = lines.reduce((sum, line) => sum + line.share, 0);
    expect(total).toBeCloseTo(1, 1);
  });

  it("has nothing to divide when the overhead is nothing", () => {
    const lines = perDiemLines([{ label: "Premises", monthly: 0 }], DEFAULT_PATTERN);
    expect(lines[0].share).toBe(0);
    expect(lines[0].perDay).toBe(0);
  });
});

describe("overheadForJob", () => {
  const perDiem = perDiemFrom(MONTHLY, DEFAULT_PATTERN);

  it("charges nothing for no time", () => {
    expect(overheadForJob(0, perDiem)).toBe(0);
    expect(overheadForJob(-4, perDiem)).toBe(0);
  });

  it("charges a fortnight's job a fortnight of overhead", () => {
    // Ten days on site, two people, eight hours: 160 crew-hours.
    expect(overheadForJob(160, perDiem)).toBeCloseTo(perDiem.perDay * 10, 0);
  });
});

describe("daysForJob", () => {
  it("turns crew-hours back into days somebody can picture", () => {
    expect(daysForJob(16, DEFAULT_PATTERN)).toBe(1);
    expect(daysForJob(40, DEFAULT_PATTERN)).toBe(2.5);
  });

  it("does not divide by an empty day", () => {
    expect(daysForJob(16, { billableDaysPerMonth: 18, hoursPerDay: 0, crewSize: 0 })).toBe(16);
  });
});

describe("flatOverheadFor", () => {
  // This is the case the flat percentage has been quietly losing money on: a
  // long job with cheap materials. Two people for four days is 64 crew-hours.
  it("under-collects on a long job with cheap materials", () => {
    const perDiem = perDiemFrom(MONTHLY, DEFAULT_PATTERN);
    const directCost = 64 * 25 + 80; // $25/crew-hour of labour, $80 of mulch.
    expect(flatOverheadFor(directCost, 2, 10)).toBeLessThan(overheadForJob(64, perDiem));
  });

  it("over-collects on an afternoon with expensive materials", () => {
    const perDiem = perDiemFrom(MONTHLY, DEFAULT_PATTERN);
    const directCost = 8 * 25 + 4_000; // Half a day, and four grand of pavers.
    expect(flatOverheadFor(directCost, 2, 10)).toBeGreaterThan(overheadForJob(8, perDiem));
  });
});

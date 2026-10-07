import { describe, expect, it } from "vitest";

import {
  crewFor,
  HORIZON_DAYS,
  milesApart,
  scoreDay,
  suggestMoves,
  suggestSchedule,
  type DayCapacity,
  type SchedulableJob,
} from "./schedule-engine";

const TODAY = "2026-09-08";

const job = (over: Partial<SchedulableJob> = {}): SchedulableJob => ({
  jobId: "j1",
  label: "12 Chestnut Drive",
  crewHours: 8,
  hoursKnown: true,
  ready: true,
  blockingIssues: 0,
  lat: 39.5,
  lng: -76.3,
  clientPreferredDate: null,
  soldAt: "2026-09-01T00:00:00.000Z",
  weatherSensitive: true,
  ...over,
});

const day = (over: Partial<DayCapacity> = {}): DayCapacity => ({
  date: "2026-09-10",
  crew: [{ profileId: "p1", name: "Dave", freeHours: 8 }],
  booked: [],
  rough: false,
  roughWhy: null,
  ...over,
});

describe("picking a crew", () => {
  it("sends the person with the most time free first", () => {
    const picked = crewFor(
      day({
        crew: [
          { profileId: "a", name: "Ann", freeHours: 3 },
          { profileId: "b", name: "Ben", freeHours: 7 },
        ],
      }),
      6
    );
    expect(picked.crew.map((c) => c.name)).toEqual(["Ben"]);
    expect(picked.covered).toBe(true);
  });

  it("adds people until the hours are covered", () => {
    const picked = crewFor(
      day({
        crew: [
          { profileId: "a", name: "Ann", freeHours: 4 },
          { profileId: "b", name: "Ben", freeHours: 4 },
        ],
      }),
      7
    );
    expect(picked.crew).toHaveLength(2);
    expect(picked.covered).toBe(true);
  });

  it("says plainly when there are not enough hours", () => {
    const picked = crewFor(day({ crew: [{ profileId: "a", name: "Ann", freeHours: 2 }] }), 8);
    expect(picked.covered).toBe(false);
  });
});

describe("scoring one day", () => {
  it("refuses a day with nobody free", () => {
    expect(scoreDay(job(), day({ crew: [] }), TODAY)).toBeNull();
  });

  it("refuses rough weather for work the weather stops", () => {
    expect(scoreDay(job(), day({ rough: true, roughWhy: "80% rain" }), TODAY)).toBeNull();
  });

  it("still offers a rough day for work the weather does not stop", () => {
    const s = scoreDay(job({ weatherSensitive: false }), day({ rough: true, roughWhy: "80% rain" }), TODAY);
    expect(s).not.toBeNull();
    expect(s!.because.join(" ")).toContain("not weather-sensitive");
  });

  it("puts the client's own choice above everything else it knows", () => {
    const chosen = scoreDay(job({ clientPreferredDate: "2026-09-10" }), day(), TODAY)!;
    const notChosen = scoreDay(job({ clientPreferredDate: "2026-09-20" }), day(), TODAY)!;
    expect(chosen.score).toBeGreaterThan(notChosen.score);
    expect(chosen.because).toContain("The client picked this day on their proposal.");
  });

  it("groups jobs that are on top of each other", () => {
    const near = scoreDay(job(), day({ booked: [{ jobId: "j2", lat: 39.505, lng: -76.3 }] }), TODAY)!;
    const alone = scoreDay(job(), day(), TODAY)!;
    expect(near.score).toBeGreaterThan(alone.score);
    expect(near.because.some((b) => b.includes("miles away"))).toBe(true);
  });

  it("says when it assumed a duration rather than knowing one", () => {
    const s = scoreDay(job({ hoursKnown: false, crewHours: 0 }), day(), TODAY)!;
    expect(s.unknowns).toContain("No timing on the services, so a full day is assumed.");
  });

  it("says when a property has no position rather than grouping it anyway", () => {
    const s = scoreDay(job({ lat: null, lng: null }), day(), TODAY)!;
    expect(s.unknowns).toContain("The property has no map position, so nothing was grouped by travel.");
  });

  it("offers a job that is not ready, and says so rather than hiding it", () => {
    const s = scoreDay(job({ ready: false, blockingIssues: 2 }), day(), TODAY)!;
    expect(s.because.some((b) => b.includes("2 blocking issues"))).toBe(true);
    expect(s.unknowns).toContain("Whether it will be ready by then.");
    expect(s.score).toBeLessThan(scoreDay(job(), day(), TODAY)!.score);
  });

  it("prefers sooner, gently", () => {
    const soon = scoreDay(job(), day({ date: "2026-09-10" }), TODAY)!;
    const later = scoreDay(job(), day({ date: "2026-09-24" }), TODAY)!;
    expect(soon.score).toBeGreaterThan(later.score);
    // Gently: a fortnight out is not disqualifying.
    expect(later.score).toBeGreaterThan(0);
  });

  it("always attaches a reason to whatever it suggests", () => {
    expect(scoreDay(job(), day(), TODAY)!.because.length).toBeGreaterThan(0);
  });
});

describe("suggesting a schedule", () => {
  const week: DayCapacity[] = [
    day({ date: "2026-09-10" }),
    day({ date: "2026-09-11" }),
    day({ date: "2026-09-12" }),
  ];

  it("gives one answer per job, not a menu", () => {
    const out = suggestSchedule([job(), job({ jobId: "j2", label: "8 Oak" })], week, TODAY);
    expect(out.filter((s) => s.jobId === "j1")).toHaveLength(1);
    expect(out.filter((s) => s.jobId === "j2")).toHaveLength(1);
  });

  it("does not offer the same person's only day to two jobs", () => {
    const oneDay = [day({ date: "2026-09-10", crew: [{ profileId: "p1", name: "Dave", freeHours: 8 }] })];
    const out = suggestSchedule([job(), job({ jobId: "j2", label: "8 Oak" })], oneDay, TODAY);
    // The second job either goes without a suggestion or is told the hours do
    // not cover it. What it must never be is silently double-booked.
    const second = out.find((s) => s.jobId === "j2");
    if (second) expect(second.because.join(" ")).toContain("hours are free");
  });

  it("takes the oldest sold work first", () => {
    const oneDay = [day({ date: "2026-09-10", crew: [{ profileId: "p1", name: "Dave", freeHours: 8 }] })];
    const out = suggestSchedule(
      [
        job({ jobId: "new", soldAt: "2026-09-05T00:00:00.000Z" }),
        job({ jobId: "old", soldAt: "2026-06-01T00:00:00.000Z" }),
      ],
      oneDay,
      TODAY
    );
    expect(out[0].jobId).toBe("old");
  });

  it("looks four weeks ahead and no further", () => {
    const far = [day({ date: "2026-11-01" })];
    expect(suggestSchedule([job()], far, TODAY)).toEqual([]);
    expect(HORIZON_DAYS).toBe(28);
  });

  it("suggests nothing rather than something wrong when no day works", () => {
    expect(suggestSchedule([job()], [day({ crew: [] })], TODAY)).toEqual([]);
  });
});

describe("weather moves", () => {
  const days = [
    day({ date: "2026-09-10", rough: true, roughWhy: "80% rain" }),
    day({ date: "2026-09-11" }),
  ];

  it("flags booked work a forecast is about to spoil", () => {
    const out = suggestMoves([{ job: job(), date: "2026-09-10" }], days, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].from).toBe("2026-09-10");
    expect(out[0].to).toBe("2026-09-11");
    expect(out[0].because[0]).toContain("80% rain");
  });

  it("leaves work the weather does not stop where it is", () => {
    expect(suggestMoves([{ job: job({ weatherSensitive: false }), date: "2026-09-10" }], days, TODAY)).toEqual([]);
  });

  it("says there is nowhere to put it rather than inventing a day", () => {
    const noRoom = [day({ date: "2026-09-10", rough: true, roughWhy: "hail" })];
    const out = suggestMoves([{ job: job(), date: "2026-09-10" }], noRoom, TODAY);
    expect(out[0].to).toBeNull();
    expect(out[0].because).toContain("Nothing in the next four weeks has the room.");
  });
});

describe("distance", () => {
  it("is null when either end has no position", () => {
    expect(milesApart({ lat: null, lng: null }, { lat: 39.5, lng: -76.3 })).toBeNull();
  });

  it("is about right for a short hop", () => {
    const miles = milesApart({ lat: 39.5, lng: -76.3 }, { lat: 39.55, lng: -76.3 })!;
    expect(miles).toBeGreaterThan(3.3);
    expect(miles).toBeLessThan(3.6);
  });
});

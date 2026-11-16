import { describe, expect, it } from "vitest";

import { checkInsOn, checkInsThrough, fullyOperating, levelOf, nextTrainingPhase, phaseOn, reviewDates, trainingKey } from "@/lib/hiring/journey";

// Monday 2026-11-16 as the first day.
const START = "2026-11-16";

describe("check-ins", () => {
  it("are twice a day for the first ten work days", () => {
    expect(checkInsOn(START, "2026-11-16").map((c) => c.key)).toEqual(["2026-11-16-am", "2026-11-16-pm"]);
    expect(phaseOn(START, "2026-11-27")).toBe("twice_daily");
    expect(checkInsThrough(START, "2026-11-27").length).toBe(20);
  });

  it("skip weekends", () => {
    expect(checkInsOn(START, "2026-11-21")).toEqual([]);
  });

  it("taper to daily, then twice a week, then a weekly one-on-one", () => {
    expect(phaseOn(START, "2026-11-30")).toBe("daily");
    expect(checkInsOn(START, "2026-11-30").map((c) => c.label)).toEqual(["Daily check-in"]);
    expect(phaseOn(START, "2026-12-14")).toBe("twice_weekly");
    expect(checkInsOn(START, "2026-12-14").length).toBe(1); // Monday
    expect(checkInsOn(START, "2026-12-15")).toEqual([]); // Tuesday
    expect(phaseOn(START, "2027-01-15")).toBe("one_on_one");
    expect(checkInsOn(START, "2027-01-18").map((c) => c.label)).toEqual(["One-on-one"]);
  });

  it("start after a weekend start date", () => {
    expect(checkInsOn("2026-11-15", "2026-11-15")).toEqual([]);
    expect(phaseOn("2026-11-15", "2026-11-27")).toBe("twice_daily");
  });
});

describe("reviews", () => {
  it("fall on days 30, 60 and 90", () => {
    expect(reviewDates(START)).toEqual({ 30: "2026-12-15", 60: "2027-01-14", 90: "2027-02-13" });
  });
});

describe("training", () => {
  it("goes shown, done while watched, released, in order", () => {
    const done = new Set([trainingKey("mulch", "demonstrated")]);
    expect(nextTrainingPhase(done, "mulch")).toBe("duplicated");
    expect(nextTrainingPhase(new Set(), "mulch")).toBe("demonstrated");
    done.add(trainingKey("mulch", "duplicated")).add(trainingKey("mulch", "released"));
    expect(nextTrainingPhase(done, "mulch")).toBeNull();
  });
});

describe("fully operating and levels", () => {
  const tasks = ["a", "b"];
  const allReleased = new Set(tasks.flatMap((t) => ["demonstrated", "duplicated", "released"].map((p) => `${t}:${p}`)));

  it("needs one-on-ones, every task released and the day 30 and 60 reviews", () => {
    const early = fullyOperating({ startDate: START, today: "2026-12-01", tasks, training: new Set(), reviewsDone: new Set(), taughtOthers: 0, ownsChecklists: false });
    expect(early.reached).toBe(false);
    expect(early.missing.length).toBe(4);
    const later = fullyOperating({ startDate: START, today: "2027-01-20", tasks, training: allReleased, reviewsDone: new Set([30, 60] as const), taughtOthers: 0, ownsChecklists: false });
    expect(later).toEqual({ reached: true, missing: [] });
  });

  it("climbs one level at a time", () => {
    expect(levelOf({ tasks, training: new Set(), taughtOthers: 3, ownsChecklists: true })).toBe("none");
    expect(levelOf({ tasks, training: allReleased, taughtOthers: 0, ownsChecklists: true })).toBe("individual_contributor");
    expect(levelOf({ tasks, training: allReleased, taughtOthers: 2, ownsChecklists: false })).toBe("manager");
    expect(levelOf({ tasks, training: allReleased, taughtOthers: 2, ownsChecklists: true })).toBe("leader");
  });
});

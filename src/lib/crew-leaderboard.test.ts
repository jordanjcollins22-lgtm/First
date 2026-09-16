import { describe, expect, it } from "vitest";

import { finishedOnTime, rankCrew, type CrewJob } from "./crew-leaderboard";

function job(over: Partial<CrewJob>): CrewJob {
  return {
    jobId: Math.random().toString(36).slice(2),
    status: "completed",
    lead: false,
    sessionsScheduled: 1,
    sessionsDone: 1,
    firstDay: "2026-09-01",
    lastDay: "2026-09-01",
    projectEndDate: "2026-09-01",
    completedAt: "2026-09-01T20:00:00Z",
    tickets: [],
    issues: [],
    ...over,
  };
}

describe("finishedOnTime", () => {
  it("reads the finish on the business's day", () => {
    // 11:30 PM Eastern on the 1st is 03:30 UTC on the 2nd; still the 1st here.
    expect(finishedOnTime({ completedAt: "2026-09-02T03:30:00Z", projectEndDate: "2026-09-01", lastDay: null })).toBe(true);
    expect(finishedOnTime({ completedAt: "2026-09-03T15:00:00Z", projectEndDate: "2026-09-01", lastDay: null })).toBe(false);
  });

  it("falls back to the last work day, and says nothing about unfinished work", () => {
    expect(finishedOnTime({ completedAt: "2026-09-01T15:00:00Z", projectEndDate: null, lastDay: "2026-09-02" })).toBe(true);
    expect(finishedOnTime({ completedAt: null, projectEndDate: "2026-09-01", lastDay: null })).toBeNull();
  });
});

describe("rankCrew", () => {
  it("puts the most finished first, and fewer mistakes ahead on a tie", () => {
    const ranked = rankCrew([
      { profileId: "a", name: "Ann", jobs: [job({}), job({ tickets: [{ cause: "workmanship" }] })] },
      { profileId: "b", name: "Bo", jobs: [job({}), job({})] },
      { profileId: "c", name: "Cy", jobs: [job({}), job({ status: "in_progress", completedAt: null })] },
    ]);
    expect(ranked.map((s) => `${s.rank} ${s.name}`)).toEqual(["1 Bo", "2 Ann", "3 Cy"]);
    expect(ranked[1].mistakes).toBe(1);
    expect(ranked[1].callbacks).toBe(1);
  });

  it("counts on time and late, days, leads, and what the client raised", () => {
    const [s] = rankCrew([
      {
        profileId: "a",
        name: "Ann",
        jobs: [
          job({ lead: true, sessionsScheduled: 3, sessionsDone: 3 }),
          job({ completedAt: "2026-09-05T15:00:00Z", projectEndDate: "2026-09-01", tickets: [{ cause: "weather" }], issues: [{ type: "complaint" }, { type: "scope" }] }),
        ],
      },
    ]);
    expect(s).toMatchObject({ jobs: 2, led: 1, daysWorked: 4, daysScheduled: 4, completed: 2, onTime: 1, late: 1, onTimeRate: 0.5, mistakes: 0, callbacks: 1, complaints: 1 });
  });

  it("keeps to the window and drops anyone with nothing in it", () => {
    const ranked = rankCrew(
      [{ profileId: "a", name: "Ann", jobs: [job({ lastDay: "2026-06-01" })] }, { profileId: "b", name: "Bo", jobs: [job({ lastDay: "2026-09-10" })] }],
      { since: new Date("2026-08-01T00:00:00Z") }
    );
    expect(ranked.map((s) => s.name)).toEqual(["Bo"]);
  });
});

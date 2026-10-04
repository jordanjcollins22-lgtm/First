import { describe, expect, it } from "vitest";

import { MISSION_CATEGORIES, elapsed, missionFor, pickMission } from "@/lib/missions";

describe("mission catalog", () => {
  it("has a mission in every category, each with a goal, steps and words", () => {
    for (const category of MISSION_CATEGORIES) {
      expect(category.missions.length).toBeGreaterThan(0);
      for (const m of category.missions) {
        expect(m.goal).toBeGreaterThan(0);
        expect(m.steps.length).toBeGreaterThan(0);
        expect(m.scripts({ first: "Max", link: "https://x.test/book?ref=1" }).length).toBeGreaterThan(0);
      }
    }
  });

  it("keys are unique", () => {
    const keys = MISSION_CATEGORIES.flatMap((c) => c.missions.map((m) => m.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("writes their name and link into the words", () => {
    const text = missionFor("people-100")!.mission.scripts({ first: "Max", link: "https://x.test/book?ref=abc" })[0].text;
    expect(text).toContain("Max");
    expect(text).toContain("https://x.test/book?ref=abc");
  });
});

describe("pickMission", () => {
  it("hands out one they have not done yet", () => {
    const picked = pickMission("people", [{ missionKey: "people-100", startedAt: "2026-10-01" }, { missionKey: "people-post", startedAt: "2026-10-02" }], () => 0);
    expect(picked?.key).toBe("people-share");
  });

  it("once all are done, hands out the one done longest ago", () => {
    const done = [
      { missionKey: "people-100", startedAt: "2026-10-03" },
      { missionKey: "people-post", startedAt: "2026-09-01" },
      { missionKey: "people-share", startedAt: "2026-10-02" },
    ];
    expect(pickMission("people", done)?.key).toBe("people-post");
  });

  it("knows nothing about a category that does not exist", () => {
    expect(pickMission("nope", [])).toBeNull();
  });
});

describe("elapsed", () => {
  it("reads in minutes, hours and days", () => {
    const now = new Date("2026-10-04T12:00:00Z");
    expect(elapsed("2026-10-04T11:15:00Z", now)).toBe("45m");
    expect(elapsed("2026-10-04T09:46:00Z", now)).toBe("2h 14m");
    expect(elapsed("2026-10-01T08:00:00Z", now)).toBe("3 days 4h");
  });
});

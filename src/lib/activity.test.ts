import { describe, expect, it } from "vitest";

import { activityHeadline, buildActivity, type CrewEventRow, type MilestoneRow, type SessionRow } from "@/lib/activity";

const NAMES = new Map([["p1", "Mike Dunn"]]);
const JOBS = new Map([["j1", "208 Crafton Rd"]]);

function crew(o: Partial<CrewEventRow> = {}): CrewEventRow {
  return { id: "c1", kind: "arrived_job", at: "2026-08-19T12:00:00Z", profileId: "p1", jobId: "j1", note: null, ...o };
}

function session(o: Partial<SessionRow> = {}): SessionRow {
  return { id: "s1", jobId: "j1", status: "in_progress", at: "2026-08-19T12:30:00Z", pauseReason: null, purpose: null, ...o };
}

function milestone(o: Partial<MilestoneRow> = {}): MilestoneRow {
  return {
    id: "m1",
    jobId: "j1",
    kind: "walkthrough_requested",
    at: "2026-08-19T15:00:00Z",
    profileId: "p1",
    detail: null,
    outcome: null,
    ...o,
  };
}

describe("buildActivity", () => {
  it("turns a crew tap into a line somebody can read", () => {
    const [item] = buildActivity([crew()], [], [], NAMES, JOBS);
    expect(item.text).toBe("Arrived on site");
    expect(item.personName).toBe("Mike Dunn");
    expect(item.jobLabel).toBe("208 Crafton Rd");
  });

  it("merges all three sources into one feed, newest first", () => {
    const feed = buildActivity([crew()], [session()], [milestone()], NAMES, JOBS);
    expect(feed.map((i) => i.text)).toEqual(["Asked for the manager's walk", "Work started", "Arrived on site"]);
  });

  it("carries the pause reason, which is the whole point of a pause", () => {
    const paused = session({ status: "paused", pauseReason: "Waiting on the mulch delivery" });
    const [item] = buildActivity([], [paused], [], NAMES, JOBS);
    expect(item.text).toBe("Work paused");
    expect(item.detail).toBe("Waiting on the mulch delivery");
    expect(item.attention).toBe(true);
  });

  it("flags a rejected walk as needing attention and a passed one as not", () => {
    const rejected = milestone({ kind: "walkthrough_reviewed", outcome: "rejected", detail: "Redo the edge" });
    const approved = milestone({ id: "m2", kind: "walkthrough_reviewed", outcome: "approved" });
    expect(buildActivity([], [], [rejected], NAMES, JOBS)[0]).toMatchObject({
      text: "Walk rejected — punch list",
      attention: true,
    });
    expect(buildActivity([], [], [approved], NAMES, JOBS)[0]).toMatchObject({
      text: "Walk approved",
      attention: false,
    });
  });

  it("skips a tap of a kind it has no words for rather than printing it raw", () => {
    // A feed is only useful if every line reads as English.
    expect(buildActivity([crew({ kind: "teleported" })], [], [], NAMES, JOBS)).toEqual([]);
  });

  it("leaves a scheduled session out — booking a visit is not doing one", () => {
    expect(buildActivity([], [session({ status: "scheduled" })], [], NAMES, JOBS)).toEqual([]);
  });

  it("says nothing rather than guessing when a name or address is missing", () => {
    const [item] = buildActivity([crew({ profileId: "ghost", jobId: "gone" })], [], [], NAMES, JOBS);
    expect(item.personName).toBeNull();
    expect(item.jobLabel).toBeNull();
  });

  it("has no job on a shop tap, which belongs to the day", () => {
    const [item] = buildActivity([crew({ kind: "left_shop", jobId: null })], [], [], NAMES, JOBS);
    expect(item.text).toBe("Left the shop");
    expect(item.jobId).toBeNull();
  });
});

describe("activityHeadline", () => {
  it("leads with what is waiting on somebody, not the total", () => {
    const feed = buildActivity([crew()], [session({ status: "paused" })], [], NAMES, JOBS);
    expect(activityHeadline(feed)).toBe("1 thing is waiting on somebody.");
  });

  it("counts updates when nothing is blocked", () => {
    expect(activityHeadline(buildActivity([crew()], [], [], NAMES, JOBS))).toBe("1 update.");
  });

  it("says so plainly when the day has not started", () => {
    expect(activityHeadline([])).toBe("Nothing logged yet.");
  });
});

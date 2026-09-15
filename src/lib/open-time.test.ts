import { describe, expect, it } from "vitest";

import { describePlay, openBlocks, playFor, scoreDay, totalOpenMinutes, workingWindow } from "./open-time";

const day = "2026-09-16";
const window = workingWindow(day);

describe("openBlocks", () => {
  it("finds the gaps between visits inside working hours", () => {
    const blocks = openBlocks(
      [
        { startsAt: "2026-09-16T13:00:00Z", endsAt: "2026-09-16T14:00:00Z", label: "Kelsey" }, // 9-10 ET
        { startsAt: "2026-09-16T18:00:00Z", endsAt: null, label: "Scott" }, // 2-3 ET
      ],
      window
    );
    expect(blocks.map((b) => [b.minutes, b.before, b.after])).toEqual([
      [60, null, "Kelsey"],
      [240, "Kelsey", "Scott"],
      [120, "Scott", null],
    ]);
    expect(totalOpenMinutes(blocks)).toBe(420);
  });

  it("is the whole day when nothing is booked, and drops travel-sized gaps", () => {
    expect(openBlocks([], window)[0].minutes).toBe(540);
    const tight = openBlocks(
      [
        { startsAt: "2026-09-16T12:00:00Z", endsAt: "2026-09-16T12:30:00Z", label: "A" },
        { startsAt: "2026-09-16T13:00:00Z", endsAt: "2026-09-16T21:00:00Z", label: "B" },
      ],
      window
    );
    expect(tight).toEqual([]);
  });

  it("ignores appointments outside the window and overlapping ones", () => {
    const blocks = openBlocks(
      [
        { startsAt: "2026-09-16T10:00:00Z", endsAt: "2026-09-16T11:00:00Z", label: "early" },
        { startsAt: "2026-09-16T13:00:00Z", endsAt: "2026-09-16T15:00:00Z", label: "A" },
        { startsAt: "2026-09-16T14:00:00Z", endsAt: "2026-09-16T16:00:00Z", label: "B" },
      ],
      window
    );
    expect(blocks.map((b) => b.minutes)).toEqual([60, 300]);
  });
});

describe("playFor and scoreDay", () => {
  it("scales the play to the gap", () => {
    expect(playFor(60)).toEqual({ comments: 4, replies: 2, links: 1, calls: false });
    expect(playFor(240)).toEqual({ comments: 16, replies: 8, links: 4, calls: true });
    expect(describePlay(playFor(60))).toContain("4 comments");
  });

  it("marks an idle day and a strong one", () => {
    expect(scoreDay(240, { comments: 0, dms: 0, posts: 0, links: 0, bookings: 0 }).verdict).toBe("idle");
    expect(scoreDay(240, { comments: 12, dms: 4, posts: 1, links: 4, bookings: 1 })).toMatchObject({ perOpenHour: 5.3, verdict: "strong" });
    expect(scoreDay(20, { comments: 0, dms: 0, posts: 0, links: 0, bookings: 0 }).verdict).toBe("no_open_time");
  });
});

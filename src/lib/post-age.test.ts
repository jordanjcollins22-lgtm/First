import { describe, expect, it } from "vitest";

import { daysOld, describeAge, fitOpenerToAge, postedAtFromLabel } from "./post-age";

// 2 p.m. in Maryland on Saturday, September 26, 2026.
const now = new Date("2026-09-26T18:00:00Z");

describe("when a post went up", () => {
  it("reads the tooltip's full date, in local time", () => {
    expect(postedAtFromLabel("Friday, September 25, 2026 at 1:04 PM", now)?.toISOString()).toBe("2026-09-25T17:04:00.000Z");
    expect(postedAtFromLabel("September 20 at 9:30 AM", now)?.toISOString()).toBe("2026-09-20T13:30:00.000Z");
    expect(postedAtFromLabel("Yesterday at 3:15 PM", now)?.toISOString()).toBe("2026-09-25T19:15:00.000Z");
  });
  it("puts a date with no year still to come last year", () => {
    expect(postedAtFromLabel("December 3 at 8:00 AM", now)?.toISOString().slice(0, 10)).toBe("2025-12-03");
  });
  it("reads the short labels", () => {
    expect(postedAtFromLabel("5h", now)?.toISOString()).toBe("2026-09-26T13:00:00.000Z");
    expect(postedAtFromLabel("3d", now)?.toISOString()).toBe("2026-09-23T18:00:00.000Z");
    expect(postedAtFromLabel("2 w", now)?.toISOString()).toBe("2026-09-12T18:00:00.000Z");
    expect(postedAtFromLabel("Just now", now)?.toISOString()).toBe(now.toISOString());
  });
  it("says nothing when the page said nothing it can read", () => {
    expect(postedAtFromLabel("Facebook", now)).toBeNull();
    expect(postedAtFromLabel("", now)).toBeNull();
  });
});

describe("what the card says", () => {
  it("fresh, aging, old, or unknown", () => {
    expect(describeAge("2026-09-26T15:00:00Z", "2026-09-26T16:00:00Z", now)).toMatchObject({ freshness: "fresh", label: "Posted 3 hours ago" });
    expect(describeAge("2026-09-25T10:00:00Z", "2026-09-26T16:00:00Z", now)).toMatchObject({ freshness: "aging", label: "Posted 1 day ago" });
    expect(describeAge("2026-09-20T10:00:00Z", "2026-09-26T16:00:00Z", now)).toMatchObject({ freshness: "old", label: "Posted 6 days ago" });
    expect(describeAge(null, "2026-09-26T16:00:00Z", now)).toMatchObject({ freshness: "unknown", label: "Found 2 hours ago" });
  });
  it("counts days from the time, or from the age it had when found", () => {
    expect(daysOld("2026-09-24T10:00:00Z", null, "2026-09-26T16:00:00Z", now)).toBe(2);
    expect(daysOld(null, 1, "2026-09-24T18:00:00Z", now)).toBe(3);
    expect(daysOld(null, null, "2026-09-24T18:00:00Z", now)).toBeNull();
  });
});

describe("the comment's opening", () => {
  const plain = "I operate JS Landscaping MD. We've been featured in the news...";
  const asking = "If you haven't gotten this taken care of yet, I operate JS Landscaping MD. We've been featured in the news...";
  it("asks if they still need someone, a day old or more", () => {
    expect(fitOpenerToAge(plain, 2)).toBe(asking);
    expect(fitOpenerToAge(asking, 2)).toBe(asking);
  });
  it("goes straight in when it is fresh", () => {
    expect(fitOpenerToAge(asking, 0)).toBe(plain);
    expect(fitOpenerToAge(plain, 0)).toBe(plain);
  });
  it("leaves it alone when the age is unknown", () => {
    expect(fitOpenerToAge(asking, null)).toBe(asking);
  });
});

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  ageDaysFromLabel,
  allowance,
  cleanPostUrl,
  localClock,
  looksLikeBlock,
  matchesKeywords,
  nextDelaySeconds,
  normaliseGroupUrl,
  postKeyFrom,
  standing,
  withinActiveHours,
  worthAnswering,
} from "./outreach-agent";

describe("postKeyFrom", () => {
  it("keys a group post on its group and post ids, whatever the tail", () => {
    expect(postKeyFrom("https://www.facebook.com/groups/123/posts/456/?__cft__[0]=abc&__tn__=R")).toBe("123/456");
    expect(postKeyFrom("https://m.facebook.com/groups/123/permalink/456")).toBe("123/456");
    expect(postKeyFrom("https://www.facebook.com/permalink.php?story_fbid=456&id=123")).toBe("123/456");
    expect(postKeyFrom("https://www.facebook.com/groups/thisisaberdeen/?multi_permalinks=456")).toBe("thisisaberdeen/456");
  });

  it("falls back to the path, and refuses nothing at all", () => {
    expect(postKeyFrom("https://www.facebook.com/someone/photos/99")).toBe("someone/99");
    expect(postKeyFrom("https://www.facebook.com/groups/123/")).toBe("www.facebook.com/groups/123");
    expect(postKeyFrom("https://www.facebook.com/")).toBeNull();
    expect(postKeyFrom("not a url")).toBeNull();
  });
});

describe("cleanPostUrl", () => {
  it("drops the tracking tail and keeps the ids that matter", () => {
    expect(cleanPostUrl("https://www.facebook.com/groups/123/posts/456/?__cft__[0]=abc")).toBe("https://www.facebook.com/groups/123/posts/456/");
    expect(cleanPostUrl("https://www.facebook.com/permalink.php?story_fbid=456&id=123&ref=x")).toBe(
      "https://www.facebook.com/permalink.php?story_fbid=456&id=123"
    );
  });
});

describe("matchesKeywords", () => {
  it("is a case-blind substring match", () => {
    expect(matchesKeywords("Anyone know someone who MOWS lawns in Bel Air?", DEFAULT_SETTINGS.keywords)).toBe(true);
    expect(matchesKeywords("Looking for a landscaper", ["landscap"])).toBe(true);
    expect(matchesKeywords("Lost dog near the park", DEFAULT_SETTINGS.keywords)).toBe(false);
    expect(matchesKeywords("", DEFAULT_SETTINGS.keywords)).toBe(false);
  });
});

describe("ageDaysFromLabel", () => {
  const now = new Date(2026, 8, 22, 12, 0, 0);
  it("reads Facebook's short labels", () => {
    expect(ageDaysFromLabel("3h", now)).toBe(0);
    expect(ageDaysFromLabel("45m", now)).toBe(0);
    expect(ageDaysFromLabel("Just now", now)).toBe(0);
    expect(ageDaysFromLabel("2d", now)).toBe(2);
    expect(ageDaysFromLabel("1w", now)).toBe(7);
    expect(ageDaysFromLabel("Yesterday at 4:12 PM", now)).toBe(1);
    expect(ageDaysFromLabel("September 14", now)).toBe(8);
    expect(ageDaysFromLabel("Sept 14 at 9:00 AM", now)).toBe(8);
  });
  it("gives up on what it cannot read", () => {
    expect(ageDaysFromLabel("", now)).toBeNull();
    expect(ageDaysFromLabel(null, now)).toBeNull();
    expect(ageDaysFromLabel("Sponsored", now)).toBeNull();
  });
});

describe("active hours", () => {
  it("compares clocks inside a plain window", () => {
    expect(withinActiveHours("08:00", "08:00", "20:00")).toBe(true);
    expect(withinActiveHours("19:59", "08:00", "20:00")).toBe(true);
    expect(withinActiveHours("20:00", "08:00", "20:00")).toBe(false);
    expect(withinActiveHours("03:00", "08:00", "20:00")).toBe(false);
  });
  it("handles a window over midnight and an always-on window", () => {
    expect(withinActiveHours("23:00", "22:00", "02:00")).toBe(true);
    expect(withinActiveHours("01:00", "22:00", "02:00")).toBe(true);
    expect(withinActiveHours("12:00", "22:00", "02:00")).toBe(false);
    expect(withinActiveHours("12:00", "00:00", "00:00")).toBe(true);
  });
  it("reads the clock in the business's zone", () => {
    // 14:30 UTC is 10:30 in New York in September.
    expect(localClock(new Date("2026-09-22T14:30:00Z"), "America/New_York")).toBe("10:30");
  });
});

describe("standing", () => {
  const base = { settings: { ...DEFAULT_SETTINGS, groups: [{ url: "https://www.facebook.com/groups/1/", name: "One" }] }, now: new Date("2026-09-22T14:30:00Z"), timeZone: "America/New_York", postedToday: 0, postedThisHour: 0 };
  it("is active in hours with room under the caps", () => {
    expect(standing(base)).toEqual({ active: true });
  });
  it("says why when it is not", () => {
    expect(standing({ ...base, settings: { ...base.settings, groups: [] } })).toEqual({ active: false, because: "no groups" });
    expect(standing({ ...base, settings: { ...base.settings, pausedUntil: "2026-09-23T00:00:00Z" } })).toEqual({ active: false, because: "paused" });
    expect(standing({ ...base, now: new Date("2026-09-22T03:00:00Z") })).toEqual({ active: false, because: "outside hours" });
    expect(standing({ ...base, postedToday: 6 })).toEqual({ active: false, because: "capped for the day" });
    expect(standing({ ...base, postedThisHour: 2 })).toEqual({ active: false, because: "capped for the hour" });
  });
  it("lets an expired pause through", () => {
    expect(standing({ ...base, settings: { ...base.settings, pausedUntil: "2026-09-22T00:00:00Z" } })).toEqual({ active: true });
  });
});

describe("allowance", () => {
  it("counts what is already waiting against both caps", () => {
    expect(allowance({ settings: DEFAULT_SETTINGS, postedToday: 0, postedThisHour: 0, queued: 0 })).toBe(2);
    expect(allowance({ settings: DEFAULT_SETTINGS, postedToday: 5, postedThisHour: 0, queued: 0 })).toBe(1);
    expect(allowance({ settings: DEFAULT_SETTINGS, postedToday: 0, postedThisHour: 1, queued: 1 })).toBe(0);
    expect(allowance({ settings: DEFAULT_SETTINGS, postedToday: 6, postedThisHour: 0, queued: 0 })).toBe(0);
  });
});

describe("worthAnswering", () => {
  it("wants a request, for something we sell, that is not stale", () => {
    expect(worthAnswering({ kind: "request", service: "Lawn Care", ageDays: 1, maxAgeDays: 5 })).toEqual({ yes: true });
    expect(worthAnswering({ kind: "request", service: "Lawn Care", ageDays: null, maxAgeDays: 5 })).toEqual({ yes: true });
    expect(worthAnswering({ kind: "promotion", service: "Lawn Care", ageDays: 0, maxAgeDays: 5 }).yes).toBe(false);
    expect(worthAnswering({ kind: "request", service: null, ageDays: 0, maxAgeDays: 5 }).yes).toBe(false);
    const old = worthAnswering({ kind: "request", service: "Lawn Care", ageDays: 9, maxAgeDays: 5 });
    expect(old.yes === false && old.decision).toBe("too_old");
  });
});

describe("pacing and blocks", () => {
  it("waits between ninety seconds and five minutes", () => {
    expect(nextDelaySeconds(() => 0)).toBe(90);
    expect(nextDelaySeconds(() => 0.999)).toBeLessThan(300);
  });
  it("recognises Facebook's stop signs", () => {
    expect(looksLikeBlock("You're Temporarily Blocked. It looks like you were misusing this feature")).toBe(true);
    expect(looksLikeBlock("Action Blocked: You can't use this feature right now")).toBe(true);
    expect(looksLikeBlock("Write a comment…")).toBe(false);
  });
});

describe("normaliseGroupUrl", () => {
  it("keeps only the group", () => {
    expect(normaliseGroupUrl("https://www.facebook.com/groups/thisisaberdeen/posts/123?x=1")).toBe("https://www.facebook.com/groups/thisisaberdeen/");
    expect(normaliseGroupUrl("https://m.facebook.com/groups/12345/")).toBe("https://www.facebook.com/groups/12345/");
    expect(normaliseGroupUrl("https://nextdoor.com/g/abc")).toBeNull();
    expect(normaliseGroupUrl("facebook")).toBeNull();
  });
});

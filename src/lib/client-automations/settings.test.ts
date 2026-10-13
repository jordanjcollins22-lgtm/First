import { describe, expect, it } from "vitest";

import { cleanReviewLink, DEFAULT_CONFIG, isLiveFor, mergeConfig, mergeSettings, nextStartedAt } from "@/lib/client-automations/settings";

describe("mergeSettings", () => {
  it("has every sequence off until it is stored on", () => {
    const all = mergeSettings([]);
    expect(Object.values(all).every((s) => !s.enabled && s.startedAt === null)).toBe(true);
    const one = mergeSettings([{ sequence: "win_back", enabled: true, started_at: "2026-10-01T00:00:00Z", config: {} }]);
    expect(one.win_back.enabled).toBe(true);
    expect(one.win_back.startedAt?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(one.review_requests.enabled).toBe(false);
  });
});

describe("mergeConfig", () => {
  it("falls back to the defaults for anything missing or silly", () => {
    expect(mergeConfig(null)).toEqual(DEFAULT_CONFIG);
    const cfg = mergeConfig({ escalatorPct: 90, followUpDays: [30, 3, "x", 7, 7], seasonStart: "13-40", reviewReminderDays: 5 });
    expect(cfg.escalatorPct).toBe(4);
    expect(cfg.followUpDays).toEqual([3, 7, 30]);
    expect(cfg.seasonStart).toBe("03-15");
    expect(cfg.reviewReminderDays).toBe(5);
  });

  it("keeps collections after the last reminder", () => {
    expect(mergeConfig({ collectionsAfterDays: 10 }).collectionsAfterDays).toBe(28);
    expect(mergeConfig({ collectionsAfterDays: 35 }).collectionsAfterDays).toBe(35);
  });
});

describe("cleanReviewLink", () => {
  it("takes https links only", () => {
    expect(cleanReviewLink("https://g.page/r/abc/review")).toBe("https://g.page/r/abc/review");
    expect(cleanReviewLink("http://g.page/r/abc")).toBe("");
    expect(cleanReviewLink("javascript:alert(1)")).toBe("");
    expect(cleanReviewLink("")).toBe("");
  });
});

describe("the go-live guard", () => {
  const on = { enabled: true, startedAt: new Date("2026-10-10T12:00:00Z") };

  it("acts only on what happened after it was switched on", () => {
    expect(isLiveFor(on, "2026-10-10T12:00:00Z")).toBe(true);
    expect(isLiveFor(on, "2026-10-11T08:00:00Z")).toBe(true);
    expect(isLiveFor(on, "2026-10-09T23:59:00Z")).toBe(false);
  });

  it("never acts while off, or on a record with no date", () => {
    expect(isLiveFor({ ...on, enabled: false }, "2026-10-11T08:00:00Z")).toBe(false);
    expect(isLiveFor({ enabled: true, startedAt: null }, "2026-10-11T08:00:00Z")).toBe(false);
    expect(isLiveFor(on, null)).toBe(false);
    expect(isLiveFor(on, "not a date")).toBe(false);
  });

  it("dates the first switch-on and keeps that date", () => {
    const now = new Date("2026-10-13T09:00:00Z");
    expect(nextStartedAt(null, false, now)).toBeNull();
    expect(nextStartedAt(null, true, now)).toEqual(now);
    expect(nextStartedAt(on.startedAt, true, now)).toEqual(on.startedAt);
    expect(nextStartedAt(on.startedAt, false, now)).toEqual(on.startedAt);
  });
});

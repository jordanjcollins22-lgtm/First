import { describe, expect, it } from "vitest";

import { DEFAULT_AUTOPILOT, mayActOn, normalizeAutopilot, normalizeStarted, stampStarted } from "./autopilot-settings";

describe("normalizeAutopilot", () => {
  it("starts from the defaults: internal automations on, anything public off", () => {
    const s = normalizeAutopilot(null);
    expect(s.enabled.plays_auto_close).toBe(true);
    expect(s.enabled.hangers_default_approve).toBe(true);
    expect(s.enabled.review_replies).toBe(false);
    expect(s.enabled.seasonal_email).toBe(false);
    expect(s.rankTowns).toContain("Havre de Grace");
    expect(s.rankTowns).toHaveLength(10);
  });

  it("keeps saved choices and clamps silly numbers", () => {
    const s = normalizeAutopilot({ enabled: { review_replies: true }, playExpiryDays: 2, gpsCoverage: 5, socialPostsPerWeek: "3", unitCostCents: { door_hangers: 30 } });
    expect(s.enabled.review_replies).toBe(true);
    expect(s.enabled.plays_auto_close).toBe(true);
    expect(s.playExpiryDays).toBe(7);
    expect(s.gpsCoverage).toBe(1);
    expect(s.socialPostsPerWeek).toBe(3);
    expect(s.unitCostCents.door_hangers).toBe(30);
    expect(s.unitCostCents.flyers).toBe(DEFAULT_AUTOPILOT.unitCostCents.flyers);
  });

  it("only accepts a real go-live date and keeps the spend band in order", () => {
    expect(normalizeAutopilot({ seasonalGoLive: "soon" }).seasonalGoLive).toBeNull();
    expect(normalizeAutopilot({ seasonalGoLive: "2026-10-20" }).seasonalGoLive).toBe("2026-10-20");
    const s = normalizeAutopilot({ spendTargetLow: 0.2, spendTargetHigh: 0.05 });
    expect(s.spendTargetLow).toBe(0.05);
    expect(s.spendTargetHigh).toBe(0.2);
  });
});

describe("started_at", () => {
  const now = new Date("2026-10-13T12:00:00Z");

  it("stamps the moment an automation is first switched on, and never moves it", () => {
    const on = normalizeAutopilot({ enabled: { review_replies: true } });
    const first = stampStarted(on, {}, now);
    expect(first.changed).toBe(true);
    expect(first.started.review_replies).toBe(now.toISOString());
    const later = stampStarted(on, first.started, new Date("2026-11-01T00:00:00Z"));
    expect(later.changed).toBe(false);
    expect(later.started.review_replies).toBe(now.toISOString());
  });

  it("acts only on records made after the switch, and never when off", () => {
    const on = normalizeAutopilot({ enabled: { review_replies: true } });
    const started = normalizeStarted({ review_replies: "2026-10-13T12:00:00Z", junk: "x" });
    expect(mayActOn("review_replies", on, started, "2026-10-12T00:00:00Z")).toBe(false);
    expect(mayActOn("review_replies", on, started, "2026-10-14T00:00:00Z")).toBe(true);
    const off = normalizeAutopilot({ enabled: { review_replies: false } });
    expect(mayActOn("review_replies", off, started, "2026-10-14T00:00:00Z")).toBe(false);
    expect(mayActOn("review_replies", on, {}, "2026-10-14T00:00:00Z")).toBe(false);
  });
});

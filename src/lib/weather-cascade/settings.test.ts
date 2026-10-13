import { describe, expect, it } from "vitest";

import { cascadeMayMove, coveredSince, DEFAULT_WEATHER_OPS, weatherOpsFrom } from "@/lib/weather-cascade/settings";

describe("weatherOpsFrom", () => {
  it("is off with safe defaults when there is no row", () => {
    const s = weatherOpsFrom(null);
    expect(s.cascadeEnabled).toBe(false);
    expect(s.autoApply).toBe(true);
    expect(s.workWeekdays).toEqual(DEFAULT_WEATHER_OPS.workWeekdays);
    expect(s.snowInvoicingEnabled).toBe(false);
  });
  it("reads the row and ignores impossible weekdays", () => {
    const s = weatherOpsFrom({ cascade_enabled: true, work_weekdays: [1, 2, 9, 6], max_auto_shift_days: 5, mow_rain_in: 0.3 });
    expect(s.cascadeEnabled).toBe(true);
    expect(s.workWeekdays).toEqual([1, 2, 6]);
    expect(s.maxAutoShiftDays).toBe(5);
    expect(s.rules.mowRainIn).toBe(0.3);
  });
});

describe("cascadeMayMove: never the backlog unless asked", () => {
  const started = "2026-10-10T12:00:00Z";
  const visit = (created: string, updated = created, status = "scheduled") => ({ status, created_at: created, updated_at: updated });
  it("moves work booked after the switch went on", () => {
    expect(cascadeMayMove(visit("2026-10-11T00:00:00Z"), { cascadeStartedAt: started, coverExisting: false })).toBe(true);
  });
  it("moves older work that was changed since", () => {
    expect(cascadeMayMove(visit("2026-09-01T00:00:00Z", "2026-10-12T00:00:00Z"), { cascadeStartedAt: started, coverExisting: false })).toBe(true);
  });
  it("leaves older untouched work alone", () => {
    expect(cascadeMayMove(visit("2026-09-01T00:00:00Z"), { cascadeStartedAt: started, coverExisting: false })).toBe(false);
  });
  it("covers older work only when the owner chose to", () => {
    expect(cascadeMayMove(visit("2026-09-01T00:00:00Z"), { cascadeStartedAt: started, coverExisting: true })).toBe(true);
  });
  it("never moves a visit under way", () => {
    expect(cascadeMayMove(visit("2026-10-11T00:00:00Z", undefined, "in_progress"), { cascadeStartedAt: started, coverExisting: true })).toBe(false);
  });
  it("moves nothing before it has ever been switched on", () => {
    expect(cascadeMayMove(visit("2026-10-11T00:00:00Z"), { cascadeStartedAt: null, coverExisting: false })).toBe(false);
  });
});

describe("coveredSince", () => {
  it("covers only what came after the switch", () => {
    expect(coveredSince("2026-12-01T00:00:00Z", "2026-12-02T00:00:00Z")).toBe(true);
    expect(coveredSince("2026-12-01T00:00:00Z", "2026-11-30T00:00:00Z")).toBe(false);
    expect(coveredSince(null, "2026-12-02T00:00:00Z")).toBe(false);
  });
});

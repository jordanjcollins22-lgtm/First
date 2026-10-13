import { describe, expect, it } from "vitest";

import { routeAlert, shouldEscalate } from "./checkin-escalation";
import { addDays, weekStartOf, weeklyBonuses } from "./crew-bonus";
import { decidePlacement, placeInOrder } from "./auto-place";
import { settingsFromRow, startStamps, AUTOPILOT_DEFAULTS } from "./autopilot-settings";
import { onTimePct } from "./kpis";
import { suggestSchedule, type DayCapacity, type SchedulableJob } from "@/lib/schedule-engine";

describe("check-in alert routing", () => {
  it("goes to the lead first and the owners on escalation", () => {
    expect(routeAlert({ quietId: "q", leadId: "lead", ownerIds: ["o1", "o2"] })).toEqual({ first: ["lead"], escalateTo: ["o1", "o2"], skippedLead: null });
  });
  it("goes straight to the owners when the lead is the quiet one, or there is no lead", () => {
    expect(routeAlert({ quietId: "lead", leadId: "lead", ownerIds: ["o1"] })).toMatchObject({ first: ["o1"], escalateTo: [], skippedLead: "lead_is_quiet" });
    expect(routeAlert({ quietId: "q", leadId: null, ownerIds: ["o1", "q"] })).toMatchObject({ first: ["o1"], skippedLead: "no_lead" });
  });
  it("does not text a lead who is also an owner twice", () => {
    expect(routeAlert({ quietId: "q", leadId: "o1", ownerIds: ["o1", "o2"] }).escalateTo).toEqual(["o2"]);
  });
  it("escalates after 30 minutes unless acknowledged or resolved", () => {
    const alert = { alertedAt: "2026-10-13T12:30:00Z", acknowledgedAt: null, escalatedAt: null, resolvedAt: null };
    expect(shouldEscalate(alert, new Date("2026-10-13T12:59:00Z"))).toBe(false);
    expect(shouldEscalate(alert, new Date("2026-10-13T13:00:00Z"))).toBe(true);
    expect(shouldEscalate({ ...alert, acknowledgedAt: "x" }, new Date("2026-10-13T14:00:00Z"))).toBe(false);
    expect(shouldEscalate({ ...alert, resolvedAt: "x" }, new Date("2026-10-13T14:00:00Z"))).toBe(false);
    expect(shouldEscalate({ ...alert, escalatedAt: "x" }, new Date("2026-10-13T14:00:00Z"))).toBe(false);
  });
});

describe("weekly crew bonus", () => {
  const jobs = [
    { jobId: "j1", budgetHours: 10, actualHours: 8, crew: ["a", "b"] },
    { jobId: "j2", budgetHours: 6, actualHours: 9, crew: ["b"] },
    { jobId: "j3", budgetHours: null, actualHours: 4, crew: ["c"] },
  ];
  it("pays each member whose jobs came in under budget", () => {
    const out = weeklyBonuses({ enabled: true, perMemberCents: 5000 }, jobs);
    expect(out.find((p) => p.profileId === "a")).toMatchObject({ earned: true, amountCents: 5000, budgetHours: 10, actualHours: 8 });
    // b: 17h against 16h across both jobs.
    expect(out.find((p) => p.profileId === "b")).toMatchObject({ earned: false, amountCents: 0, budgetHours: 16, actualHours: 17 });
    // c's only job had no budget, so there is nothing to beat.
    expect(out.find((p) => p.profileId === "c")).toMatchObject({ earned: false, jobIds: [] });
  });
  it("pays nothing while switched off", () => {
    expect(weeklyBonuses({ enabled: false, perMemberCents: 5000 }, jobs).every((p) => p.amountCents === 0)).toBe(true);
  });
  it("finds the Monday of the week", () => {
    expect(weekStartOf("2026-10-13")).toBe("2026-10-12");
    expect(weekStartOf("2026-10-18")).toBe("2026-10-12");
    expect(weekStartOf("2026-10-12")).toBe("2026-10-12");
    expect(addDays("2026-10-12", 7)).toBe("2026-10-19");
  });
});

describe("auto-placement", () => {
  const job = (over: Partial<SchedulableJob> = {}): SchedulableJob => ({
    jobId: "j1",
    label: "1 Main St",
    crewHours: 8,
    hoursKnown: true,
    ready: true,
    blockingIssues: 0,
    lat: null,
    lng: null,
    clientPreferredDate: null,
    soldAt: "2026-10-10T00:00:00Z",
    weatherSensitive: false,
    ...over,
  });
  const day = (date: string, free: number[]): DayCapacity => ({
    date,
    crew: free.map((h, i) => ({ profileId: `p${i}`, name: `P${i}`, freeHours: h })),
    booked: [],
    rough: false,
    roughWhy: null,
  });
  const one = (j: SchedulableJob, d: DayCapacity[], today: string) => suggestSchedule([j], d, today)[0] ?? null;
  const ctx = { liveSince: "2026-10-01T00:00:00Z", soldAt: "2026-10-10T00:00:00Z" };

  it("places a ready job that fits", () => {
    const [r] = placeInOrder([job()], [day("2026-10-15", [8])], "2026-10-13", one);
    expect(decidePlacement(r.job, r.suggestion, r.covered, ctx)).toMatchObject({ kind: "place" });
  });

  it("never touches work sold before go-live, or not ready", () => {
    expect(decidePlacement(job(), null, false, { ...ctx, soldAt: "2026-09-01T00:00:00Z" }).kind).toBe("skip");
    expect(decidePlacement(job(), null, false, { ...ctx, liveSince: null }).kind).toBe("skip");
    expect(decidePlacement(job({ ready: false }), null, false, ctx).kind).toBe("skip");
  });

  it("holds conflicts instead of guessing", () => {
    expect(decidePlacement(job({ hoursKnown: false }), null, false, ctx)).toMatchObject({ kind: "hold" });
    expect(decidePlacement(job(), null, false, ctx)).toMatchObject({ kind: "hold" });
    const [r] = placeInOrder([job({ crewHours: 12 })], [day("2026-10-15", [8])], "2026-10-13", one);
    expect(r.covered).toBe(false);
    expect(decidePlacement(r.job, r.suggestion, r.covered, ctx)).toMatchObject({ kind: "hold" });
  });

  it("holds when the client asked for a day that doesn't fit", () => {
    const wants = job({ clientPreferredDate: "2026-10-20" });
    const [r] = placeInOrder([wants], [day("2026-10-15", [8])], "2026-10-13", one);
    expect(decidePlacement(r.job, r.suggestion, r.covered, ctx)).toMatchObject({ kind: "hold" });
  });

  it("does not give two jobs the same free day", () => {
    const out = placeInOrder(
      [job({ jobId: "a", soldAt: "2026-10-09" }), job({ jobId: "b", soldAt: "2026-10-10" })],
      [day("2026-10-15", [8]), day("2026-10-16", [8])],
      "2026-10-13",
      one
    );
    expect(out.map((r) => r.suggestion?.date)).toEqual(["2026-10-15", "2026-10-16"]);
    expect(out.every((r) => r.covered)).toBe(true);
  });
});

describe("autopilot settings", () => {
  it("reads a missing row as the defaults", () => {
    expect(settingsFromRow(null)).toEqual(AUTOPILOT_DEFAULTS);
  });
  it("clamps silly values", () => {
    expect(settingsFromRow({ checkin_escalate_minutes: 1, auto_place_daily_cap: 999 })).toMatchObject({ checkinEscalateMinutes: 5, autoPlaceDailyCap: 50 });
  });
  it("stamps a start time on switches that are on and never started", () => {
    const stamps = startStamps({ auto_close_enabled: true, auto_close_started_at: "old", crew_bonus_enabled: false }, "now");
    expect(stamps.auto_close_started_at).toBeUndefined();
    expect(stamps.crew_bonus_started_at).toBeUndefined();
    // Defaults on, never started.
    expect(stamps.auto_place_started_at).toBe("now");
    expect(startStamps({ auto_close_enabled: true, auto_close_started_at: "old" }, "now", ["auto_close_enabled"]).auto_close_started_at).toBe("now");
  });
});

describe("on-time %", () => {
  it("counts days closed on or before their last day", () => {
    expect(
      onTimePct([
        { endsOn: "2026-10-10", status: "done", closedOn: "2026-10-10" },
        { endsOn: "2026-10-10", status: "done", closedOn: "2026-10-12" },
        { endsOn: "2026-10-11", status: "scheduled", closedOn: null },
        { endsOn: "2026-10-11", status: "cancelled", closedOn: null },
      ])
    ).toEqual({ pct: 33, of: 3 });
  });
});

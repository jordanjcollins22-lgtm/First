import { describe, expect, it } from "vitest";

import { FUNNEL_PAGES, funnelStats, isRecordedStep, type FunnelEvent, type FunnelStep } from "@/lib/funnel";

const t = (minutes: number) => new Date(Date.UTC(2026, 9, 30, 12, 0) + minutes * 60_000).toISOString();
const visit = (id: string, step: FunnelStep, at: number): FunnelEvent => ({ step, visitId: id, jobId: null, detail: null, at: t(at) });
const job = (id: string, step: FunnelStep, at: number, detail: string | null = null): FunnelEvent => ({ step, visitId: null, jobId: id, detail, at: t(at) });
const lead = (visitId: string, jobId: string, at: number): FunnelEvent => ({ step: "lead", visitId, jobId, detail: null, at: t(at) });

const page = (stats: ReturnType<typeof funnelStats>, id: string) => stats.pages.find((p) => p.page.id === id)!;

describe("funnelStats", () => {
  // Three people open booking. Two give details; one of them goes all the
  // way and pays a deposit, the other stops on the map.
  const events: FunnelEvent[] = [
    visit("v1", "book_opened", 0),
    visit("v2", "book_opened", 1),
    visit("v3", "book_opened", 2),
    visit("v1", "details_shown", 1),
    visit("v2", "details_shown", 3),
    lead("v1", "j1", 3),
    lead("v2", "j2", 6),
    job("j1", "map_opened", 3),
    job("j2", "map_opened", 6),
    job("j1", "map_tapped", 5),
    job("j1", "map_sent", 13),
    job("j1", "estimate_viewed", 13),
    job("j1", "estimate_viewed", 20), // a reload is not a second person
    job("j1", "pay_started", 16, "deposit"),
    job("j1", "paid", 18, "deposit"),
    job("j1", "schedule_viewed", 18),
    job("j1", "visit_booked", 19),
  ];
  const stats = funnelStats(events, (d) => (d === "deposit" ? "Deposit" : d));

  it("counts distinct people reaching and leaving each page", () => {
    expect(page(stats, "address")).toMatchObject({ reached: 3, completed: 2, stopped: 1, completionPct: 67 });
    expect(page(stats, "details")).toMatchObject({ reached: 2, completed: 2, stopped: 0 });
    expect(page(stats, "map")).toMatchObject({ reached: 2, completed: 1, stopped: 1, completionPct: 50 });
    expect(page(stats, "estimate")).toMatchObject({ reached: 1, completed: 1 });
    expect(page(stats, "checkout")).toMatchObject({ reached: 1, completed: 1 });
    expect(page(stats, "schedule")).toMatchObject({ reached: 1, completed: 1 });
  });

  it("follows one person from their booking visit to their job", () => {
    // v1 opened booking and j1 paid: one person, so 1 of 3 paid.
    expect(stats.started).toBe(3);
    expect(stats.paid).toBe(1);
    expect(stats.paidPct).toBe(33.3);
  });

  it("times each page from first reaching it to leaving it", () => {
    expect(page(stats, "map").medianMinutes).toBe(10);
    expect(page(stats, "address").medianMinutes).toBe(1.5);
  });

  it("splits who paid by what they paid for", () => {
    expect(stats.paidBy).toEqual([{ label: "Deposit", count: 1 }]);
  });

  it("counts who tapped after opening the map", () => {
    expect(stats.tappedAfterOpening).toBe(1);
  });

  it("is all zeros, not errors, with nothing", () => {
    const empty = funnelStats([]);
    expect(empty.pages).toHaveLength(FUNNEL_PAGES.length);
    expect(empty.pages.every((p) => p.reached === 0 && p.completionPct === null && p.medianMinutes === null)).toBe(true);
    expect(empty.paidPct).toBeNull();
  });
});

describe("isRecordedStep", () => {
  it("accepts the logged steps only", () => {
    expect(isRecordedStep("map_sent")).toBe(true);
    expect(isRecordedStep("book_opened")).toBe(false);
    expect(isRecordedStep("drop table")).toBe(false);
  });
});

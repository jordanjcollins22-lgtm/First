import { describe, expect, it } from "vitest";

import { evaluationEvents, jobWorkEvents } from "@/lib/calendar-events";
import type { JobWithLocation } from "@/lib/data/jobs";

function job(overrides: Partial<JobWithLocation> = {}): JobWithLocation {
  return {
    id: "j1",
    property_id: "p1",
    name: "Front bed rebuild",
    status: "approved",
    assigned_to: null,
    source_attractor_wave_id: null,
    evaluation_date: "2026-09-01T14:00:00Z",
    evaluation_status: "scheduled",
    project_start_date: null,
    project_end_date: null,
    client_notes: null,
    budget_range: null,
    referred_by_profile_id: null,
    cancelled_at: null,
    cancellation_reason: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    property: {
      id: "p1",
      customer_id: "c1",
      address: "12 Elm St",
      lat: 39.5,
      lng: -76.3,
      customer: { id: "c1", name: "Pat" },
    },
    ...overrides,
  } as unknown as JobWithLocation;
}

describe("evaluationEvents", () => {
  it("puts a scheduled visit on the calendar", () => {
    expect(evaluationEvents([job()])).toHaveLength(1);
  });

  it("takes a cancelled visit off the calendar", () => {
    // The date stays on the row so the history survives — which is exactly
    // why the date alone can't be what decides this.
    expect(evaluationEvents([job({ evaluation_status: "cancelled" })])).toEqual([]);
  });

  it("takes the visit off when the whole job is cancelled", () => {
    expect(evaluationEvents([job({ status: "cancelled" })])).toEqual([]);
  });

  it("ignores a job with no visit booked", () => {
    expect(evaluationEvents([job({ evaluation_date: null })])).toEqual([]);
  });
});

describe("jobWorkEvents", () => {
  it("makes one event per booked day", () => {
    const events = jobWorkEvents([
      job({ project_start_date: "2026-09-01", project_end_date: "2026-09-03" }),
    ]);
    expect(events.map((e) => e.date)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
  });

  it("keeps cancelled work off the calendar", () => {
    const events = jobWorkEvents([
      job({ status: "cancelled", project_start_date: "2026-09-01", project_end_date: "2026-09-03" }),
    ]);
    expect(events).toEqual([]);
  });

  it("ignores work with no dates", () => {
    expect(jobWorkEvents([job()])).toEqual([]);
  });
});

describe("jobWorkEvents driven by visits", () => {
  it("splits a paused job into separate blocks instead of one long run", () => {
    // The point of tracking visits: a fortnight's pause should not draw a
    // fortnight of work nobody is doing.
    const sessions = new Map([
      [
        "j1",
        [
          { starts_on: "2026-09-01", ends_on: "2026-09-02", status: "done" },
          { starts_on: "2026-09-15", ends_on: "2026-09-16", status: "scheduled" },
        ],
      ],
    ]);
    const events = jobWorkEvents([job({ project_start_date: "2026-09-01", project_end_date: "2026-09-16" })], sessions);
    expect(events.map((e) => e.date)).toEqual(["2026-09-01", "2026-09-02", "2026-09-15", "2026-09-16"]);
  });

  it("keeps a cancelled visit off the calendar", () => {
    const sessions = new Map([
      [
        "j1",
        [
          { starts_on: "2026-09-01", ends_on: "2026-09-01", status: "scheduled" },
          { starts_on: "2026-09-05", ends_on: "2026-09-05", status: "cancelled" },
        ],
      ],
    ]);
    const events = jobWorkEvents([job({ project_start_date: "2026-09-01", project_end_date: "2026-09-05" })], sessions);
    expect(events.map((e) => e.date)).toEqual(["2026-09-01"]);
  });

  it("labels a paused block so the calendar says why nothing is happening", () => {
    const sessions = new Map([
      ["j1", [{ starts_on: "2026-09-01", ends_on: "2026-09-01", status: "paused" }]],
    ]);
    expect(jobWorkEvents([job({ project_start_date: "2026-09-01" })], sessions)[0].detail).toBe("Paused");
  });

  it("falls back to the job's own window when it has no visits", () => {
    const events = jobWorkEvents([
      job({ project_start_date: "2026-09-01", project_end_date: "2026-09-02" }),
    ]);
    expect(events.map((e) => e.date)).toEqual(["2026-09-01", "2026-09-02"]);
  });
});

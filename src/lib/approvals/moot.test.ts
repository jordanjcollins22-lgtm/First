import { describe, expect, it } from "vitest";

import { duplicateBookings, mootReason, type MootJob } from "./moot";

const now = new Date("2026-10-13T12:00:00Z");
const job = (over: Partial<MootJob> = {}): MootJob => ({
  id: "j1",
  status: "estimating",
  evaluationStatus: "scheduled",
  cancelledAt: null,
  evaluationDate: "2026-10-15T14:00:00Z",
  completedAt: null,
  ...over,
});

describe("mootReason", () => {
  it("lets a live visit's emails go", () => {
    expect(mootReason({ kind: "evaluation_day_before", job: job() }, now)).toBeNull();
    expect(mootReason({ kind: "evaluation_confirmed", job: job() }, now)).toBeNull();
  });

  it("stops every evaluation email for a cancelled booking", () => {
    expect(mootReason({ kind: "evaluation_day_before", job: job({ evaluationStatus: "cancelled" }) }, now)).toBe("booking_cancelled");
    expect(mootReason({ kind: "evaluation_after", job: job({ status: "cancelled", cancelledAt: "2026-10-12T00:00:00Z" }) }, now)).toBe("booking_cancelled");
    expect(mootReason({ kind: "evaluation_reminder", job: job({ status: "cancelled" }) }, now)).toBe("booking_cancelled");
  });

  it("stops a held reminder written for a visit that has since moved", () => {
    expect(
      mootReason({ kind: "evaluation_day_before", job: job(), writtenForEvaluationAt: "2026-10-14T14:00:00Z" }, now)
    ).toBe("visit_moved");
    expect(
      mootReason({ kind: "evaluation_day_before", job: job(), writtenForEvaluationAt: "2026-10-15T14:00:00Z" }, now)
    ).toBeNull();
  });

  it("stops a before-the-visit email once the visit has happened", () => {
    expect(mootReason({ kind: "evaluation_morning_of", job: job({ evaluationDate: "2026-10-13T11:00:00Z" }) }, now)).toBe("visit_passed");
  });

  it("stops the after-the-visit email when the proposal has already gone out", () => {
    const done = job({ evaluationDate: "2026-10-13T08:00:00Z", evaluationStatus: "completed" });
    expect(mootReason({ kind: "evaluation_after", job: done, proposal: { status: "sent", sentAt: "2026-10-13T10:00:00Z" } }, now)).toBe(
      "proposal_already_sent"
    );
    expect(mootReason({ kind: "evaluation_after", job: done, proposal: { status: "needs_approval", sentAt: null } }, now)).toBeNull();
    expect(mootReason({ kind: "evaluation_after", job: done, proposal: null }, now)).toBeNull();
  });

  it("stops the second booking of one visit", () => {
    expect(mootReason({ kind: "evaluation_booked", job: job(), duplicateOf: "j0" }, now)).toBe("duplicate_booking");
  });

  it("stops a proposal follow-up once answered or once somebody has called", () => {
    const sent = { status: "sent", sentAt: "2026-10-09T12:00:00Z" };
    expect(mootReason({ kind: "proposal_follow_up", job: job(), proposal: sent, callsSinceSent: 0 }, now)).toBeNull();
    expect(mootReason({ kind: "proposal_follow_up", job: job(), proposal: { ...sent, status: "accepted" } }, now)).toBe("proposal_answered");
    expect(mootReason({ kind: "proposal_follow_up", job: job(), proposal: { ...sent, status: "declined" } }, now)).toBe("proposal_answered");
    expect(mootReason({ kind: "proposal_follow_up", job: job(), proposal: sent, callsSinceSent: 2 }, now)).toBe("already_called");
    expect(mootReason({ kind: "proposal_follow_up", job: job({ status: "cancelled" }), proposal: sent }, now)).toBe("booking_cancelled");
  });

  it("stops a job-start reminder for a cancelled or finished job", () => {
    expect(mootReason({ kind: "job_start_reminder", job: job({ status: "cancelled" }) }, now)).toBe("booking_cancelled");
    expect(mootReason({ kind: "job_start_reminder", job: job({ completedAt: "2026-10-12T00:00:00Z" }) }, now)).toBe("job_done");
    expect(mootReason({ kind: "job_start_reminder", job: job({ status: "approved" }) }, now)).toBeNull();
  });

  it("leaves kinds with no rule alone", () => {
    expect(mootReason({ kind: "invoice_reminder", job: job({ status: "cancelled" }) }, now)).toBeNull();
  });
});

describe("duplicateBookings", () => {
  const b = (id: string, email: string | null, at: string, created: string, extra: { cancelled?: boolean; cleared?: string } = {}) => ({
    id,
    email,
    evaluationDate: at,
    createdAt: created,
    cancelled: extra.cancelled ?? false,
    duplicateClearedAt: extra.cleared ?? null,
  });

  it("keeps the first booking and marks the later copy of the same visit", () => {
    const copies = duplicateBookings([
      b("app", "Pat@Example.com", "2026-10-15T14:00:00Z", "2026-10-10T09:00:00Z"),
      b("ghl", "pat@example.com ", "2026-10-15T14:30:00Z", "2026-10-10T09:05:00Z"),
    ]);
    expect([...copies.entries()]).toEqual([["ghl", "app"]]);
  });

  it("does not pair different times, cancelled bookings, or vouched-for jobs", () => {
    expect(
      duplicateBookings([
        b("a", "pat@example.com", "2026-10-15T14:00:00Z", "2026-10-10T09:00:00Z"),
        b("b", "pat@example.com", "2026-10-17T14:00:00Z", "2026-10-10T09:05:00Z"),
      ]).size
    ).toBe(0);
    expect(
      duplicateBookings([
        b("a", "pat@example.com", "2026-10-15T14:00:00Z", "2026-10-10T09:00:00Z", { cancelled: true }),
        b("b", "pat@example.com", "2026-10-15T14:00:00Z", "2026-10-10T09:05:00Z"),
      ]).size
    ).toBe(0);
    expect(
      duplicateBookings([
        b("a", "pat@example.com", "2026-10-15T14:00:00Z", "2026-10-10T09:00:00Z"),
        b("b", "pat@example.com", "2026-10-15T14:00:00Z", "2026-10-10T09:05:00Z", { cleared: "2026-10-11T00:00:00Z" }),
      ]).size
    ).toBe(0);
  });

  it("does not pair different people at one time", () => {
    expect(
      duplicateBookings([
        b("a", "pat@example.com", "2026-10-15T14:00:00Z", "2026-10-10T09:00:00Z"),
        b("b", "sam@example.com", "2026-10-15T14:00:00Z", "2026-10-10T09:05:00Z"),
        b("c", null, "2026-10-15T14:00:00Z", "2026-10-10T09:06:00Z"),
      ]).size
    ).toBe(0);
  });
});

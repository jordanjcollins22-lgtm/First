import { describe, expect, it } from "vitest";

import { autoSendAt, decideHold, defaultModeFor, dueToAutoSend, isLowRisk } from "./policy";

describe("defaultModeFor", () => {
  it("auto-sends the transactional kinds", () => {
    for (const kind of [
      "evaluation_confirmed",
      "evaluation_booked",
      "evaluation_two_days",
      "evaluation_day_before",
      "evaluation_morning_of",
      "evaluation_after",
      "evaluation_reminder",
      "job_start_reminder",
      "thank_you",
      "tip_thank_you",
      "proposal_follow_up",
      "invoice_reminder",
      "invoice_overdue_7",
      "review_request",
      "review_request_day3",
    ]) {
      expect(defaultModeFor(kind), kind).toBe("auto");
    }
  });

  it("holds team requests, AI-ish and unknown kinds", () => {
    expect(defaultModeFor("team_request")).toBe("hold");
    expect(defaultModeFor("measurements_request")).toBe("hold");
    expect(defaultModeFor("ai_reply")).toBe("hold");
    expect(defaultModeFor("something_new")).toBe("hold");
    expect(isLowRisk("proposal_ready")).toBe(false);
  });
});

describe("decideHold", () => {
  const base = { masterHold: false, kind: "evaluation_day_before", storedMode: null };

  it("sends a proven transactional email straight away", () => {
    expect(decideHold({ ...base, firstSend: false })).toEqual({ hold: false, mode: "auto" });
  });

  it("holds everything under the master hold, and never sends it on its own", () => {
    expect(decideHold({ ...base, masterHold: true, firstSend: false })).toEqual({ hold: true, mode: "auto", reason: "master", sendOnExpiry: false });
  });

  it("holds AI-written text whatever the kind says", () => {
    const d = decideHold({ ...base, aiWritten: true, firstSend: false });
    expect(d).toMatchObject({ hold: true, reason: "ai_written", sendOnExpiry: false });
  });

  it("holds a team request even when its stored mode says auto", () => {
    const d = decideHold({ masterHold: false, kind: "measurements_request", storedMode: "auto", firstSend: false });
    expect(d).toMatchObject({ hold: true, reason: "team_request", sendOnExpiry: false });
  });

  it("holds the first send of a kind, and sends a low-risk one if nobody stops it", () => {
    expect(decideHold({ ...base, firstSend: true })).toMatchObject({ hold: true, reason: "first_send", sendOnExpiry: true });
  });

  it("does not auto-send the first send of a kind that is not low-risk", () => {
    const d = decideHold({ masterHold: false, kind: "seasonal_reengage", storedMode: "auto", firstSend: true });
    expect(d).toMatchObject({ hold: true, reason: "first_send", sendOnExpiry: false });
  });

  it("honours a stored hold and hold_then_send", () => {
    expect(decideHold({ ...base, storedMode: "hold", firstSend: false })).toMatchObject({ hold: true, reason: "policy", sendOnExpiry: false });
    expect(decideHold({ ...base, storedMode: "hold_then_send", firstSend: false })).toMatchObject({ hold: true, reason: "policy", sendOnExpiry: true });
  });

  it("treats an unreadable history as proven", () => {
    expect(decideHold({ ...base, firstSend: null })).toEqual({ hold: false, mode: "auto" });
  });
});

describe("autoSendAt", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const h = (n: number) => new Date(now.getTime() + n * 3_600_000);

  it("waits half the window, at most twelve hours", () => {
    expect(autoSendAt(now, h(12))?.toISOString()).toBe(h(6).toISOString());
    expect(autoSendAt(now, h(72))?.toISOString()).toBe(h(12).toISOString());
  });

  it("waits at least an hour, and never past the stale moment", () => {
    expect(autoSendAt(now, h(1.5))?.toISOString()).toBe(h(1).toISOString());
    expect(autoSendAt(now, h(0.5))).toBeNull();
    expect(autoSendAt(now, h(-1))).toBeNull();
  });

  it("gives twelve hours when the email never goes stale", () => {
    expect(autoSendAt(now, null)?.toISOString()).toBe(h(12).toISOString());
  });
});

describe("dueToAutoSend", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  it("sends once the window has closed and before it is stale", () => {
    expect(dueToAutoSend({ sendOnExpiry: true, autoSendAt: "2026-10-13T11:00:00Z", expiresAt: "2026-10-13T15:00:00Z" }, now)).toBe(true);
  });
  it("does not send early, late, or when not asked to", () => {
    expect(dueToAutoSend({ sendOnExpiry: true, autoSendAt: "2026-10-13T13:00:00Z", expiresAt: null }, now)).toBe(false);
    expect(dueToAutoSend({ sendOnExpiry: true, autoSendAt: "2026-10-13T11:00:00Z", expiresAt: "2026-10-13T11:30:00Z" }, now)).toBe(false);
    expect(dueToAutoSend({ sendOnExpiry: false, autoSendAt: "2026-10-13T11:00:00Z", expiresAt: null }, now)).toBe(false);
  });
});

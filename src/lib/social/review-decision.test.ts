import { describe, expect, it } from "vitest";

import {
  DENY_REASON_MAX,
  POSTING_STATUSES,
  canApprove,
  canDeny,
  canUndoDeny,
  countDecisions,
  decide,
  denyUpdate,
  isDenyNotReady,
  tidyDenyReason,
  undoDenyUpdate,
} from "./review-decision";

const now = new Date("2026-11-12T15:00:00Z");

describe("approve and deny", () => {
  it("never posts a denied post", () => {
    expect(POSTING_STATUSES).not.toContain("denied");
    expect(POSTING_STATUSES as readonly string[]).not.toContain(denyUpdate({ userId: "u", now }).status);
  });

  it("approves only drafts", () => {
    expect(canApprove("draft")).toBe(true);
    for (const s of ["approved", "scheduled", "posted", "denied", "failed", "skipped"]) expect(canApprove(s), s).toBe(false);
  });

  it("denies drafts and approved posts not yet out", () => {
    for (const s of ["draft", "approved", "scheduled"]) expect(canDeny(s), s).toBe(true);
    for (const s of ["posted", "denied", "failed", "skipped"]) expect(canDeny(s), s).toBe(false);
  });

  it("undoes only a denial", () => {
    expect(canUndoDeny("denied")).toBe(true);
    for (const s of ["draft", "scheduled", "posted", "skipped"]) expect(canUndoDeny(s), s).toBe(false);
  });

  it("takes a denied post off the schedule and clears its approval", () => {
    const u = denyUpdate({ reason: "  wrong   photo ", userId: "user-1", now });
    expect(u).toMatchObject({
      status: "denied",
      scheduled_for: null,
      next_attempt_at: null,
      approved_by: null,
      approved_at: null,
      denied_reason: "wrong photo",
      denied_by: "user-1",
      denied_at: now.toISOString(),
    });
  });

  it("keeps the reason optional and short", () => {
    expect(denyUpdate({ userId: "u", now }).denied_reason).toBeNull();
    expect(tidyDenyReason("   ")).toBeNull();
    expect(tidyDenyReason(null)).toBeNull();
    const long = tidyDenyReason("x".repeat(500));
    expect(long).toHaveLength(DENY_REASON_MAX);
    expect(long?.endsWith("…")).toBe(true);
  });

  it("undo puts it back to a draft with no time and no reason", () => {
    expect(undoDenyUpdate(now)).toEqual({
      status: "draft",
      scheduled_for: null,
      denied_reason: null,
      denied_by: null,
      denied_at: null,
      updated_at: now.toISOString(),
    });
    expect(canApprove(undoDenyUpdate(now).status)).toBe(true);
  });

  it("knows when migration 0374 isn't in", () => {
    expect(isDenyNotReady({ code: "23514", message: "violates check constraint" })).toBe(true);
    expect(isDenyNotReady({ code: "PGRST204", message: "Could not find the 'denied_reason' column" })).toBe(true);
    expect(isDenyNotReady({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isDenyNotReady(null)).toBe(false);
  });
});

describe("preview decisions", () => {
  it("marks, switches and takes back a card", () => {
    let d = decide({}, 1, "approved");
    expect(d).toEqual({ 1: "approved" });
    d = decide(d, 1, "denied");
    expect(d).toEqual({ 1: "denied" });
    d = decide(d, 1, "denied");
    expect(d).toEqual({});
  });

  it("counts", () => {
    const d = decide(decide(decide({}, 1, "approved"), 2, "approved"), 3, "denied");
    expect(countDecisions(d, 12)).toEqual({ approved: 2, denied: 1, undecided: 9 });
  });
});

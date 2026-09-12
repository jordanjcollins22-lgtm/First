import { describe, expect, it } from "vitest";

import {
  canRequestWalkthrough,
  canReviewWalkthrough,
  currentWalkthrough,
  isApproved,
  isAwaitingReview,
  minutesWaiting,
  walkthroughGate,
  type WalkthroughShape,
} from "@/lib/walkthrough";

function w(overrides: Partial<WalkthroughShape> = {}): WalkthroughShape {
  return {
    status: "requested",
    requested_at: "2026-09-10T14:00:00Z",
    reviewed_at: null,
    review_notes: null,
    ...overrides,
  };
}

describe("currentWalkthrough", () => {
  it("takes the newest, since rows come newest first", () => {
    const rows = [w({ status: "approved" }), w({ status: "rejected" })];
    expect(currentWalkthrough(rows)?.status).toBe("approved");
  });

  it("skips withdrawn requests entirely", () => {
    // Withdrawing should leave the job exactly where it was.
    const rows = [w({ status: "cancelled" }), w({ status: "approved" })];
    expect(currentWalkthrough(rows)?.status).toBe("approved");
  });

  it("is nothing when none exist", () => {
    expect(currentWalkthrough([])).toBeNull();
  });
});

describe("walkthroughGate", () => {
  it("blocks sign-off when nobody has been asked", () => {
    const verdict = walkthroughGate([]);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/account manager/i);
  });

  it("blocks sign-off while the manager still hasn't come out", () => {
    const verdict = walkthroughGate([w()]);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/waiting on/i);
  });

  it("opens sign-off once approved", () => {
    expect(walkthroughGate([w({ status: "approved", reviewed_at: "2026-09-10T15:00:00Z" })]).ok).toBe(true);
  });

  it("puts the punch list in the refusal so the crew knows what to fix", () => {
    const verdict = walkthroughGate([
      w({ status: "rejected", reviewed_at: "x", review_notes: "Edging loose by the gate" }),
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain("Edging loose by the gate");
  });

  it("still refuses a rejection that came with no notes", () => {
    const verdict = walkthroughGate([w({ status: "rejected", reviewed_at: "x" })]);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/request the walk again/i);
  });

  it("passes a job that was rejected, fixed, and walked again", () => {
    const rows = [
      w({ status: "approved", reviewed_at: "2026-09-11T10:00:00Z" }),
      w({ status: "rejected", reviewed_at: "2026-09-10T15:00:00Z", review_notes: "Edging" }),
    ];
    expect(walkthroughGate(rows).ok).toBe(true);
  });
});

describe("canRequestWalkthrough", () => {
  it("refuses before anybody has been on site", () => {
    expect(canRequestWalkthrough(false, []).ok).toBe(false);
  });

  it("lets the crew ask once work has started", () => {
    expect(canRequestWalkthrough(true, []).ok).toBe(true);
  });

  it("refuses to stack a second request on a pending one", () => {
    // Five identical requests bury the real one.
    const verdict = canRequestWalkthrough(true, [w()]);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/hasn't been out/i);
  });

  it("lets the crew ask again after a rejection", () => {
    expect(canRequestWalkthrough(true, [w({ status: "rejected", reviewed_at: "x" })]).ok).toBe(true);
  });

  it("refuses once already approved", () => {
    expect(canRequestWalkthrough(true, [w({ status: "approved", reviewed_at: "x" })]).ok).toBe(false);
  });
});

describe("canReviewWalkthrough", () => {
  it("lets a manager rule on a pending request", () => {
    expect(canReviewWalkthrough([w()]).ok).toBe(true);
  });

  it("refuses when nothing was asked", () => {
    expect(canReviewWalkthrough([]).ok).toBe(false);
  });

  it("refuses to decide the same walk twice", () => {
    expect(canReviewWalkthrough([w({ status: "approved", reviewed_at: "x" })]).ok).toBe(false);
  });
});

describe("isApproved / isAwaitingReview", () => {
  it("reads the current state", () => {
    expect(isApproved([w({ status: "approved", reviewed_at: "x" })])).toBe(true);
    expect(isAwaitingReview([w()])).toBe(true);
    expect(isApproved([w()])).toBe(false);
  });
});

describe("minutesWaiting", () => {
  it("counts how long the crew has been held up", () => {
    expect(minutesWaiting(w(), new Date("2026-09-10T14:25:00Z"))).toBe(25);
  });

  it("never goes negative on a clock skew", () => {
    expect(minutesWaiting(w(), new Date("2026-09-10T13:00:00Z"))).toBe(0);
  });
});

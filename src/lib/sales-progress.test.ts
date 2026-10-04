import { describe, expect, it } from "vitest";

import { salesStage, salesStepState, type SalesInput } from "@/lib/sales-progress";

const now = new Date("2026-10-04T15:00:00Z");
const base: SalesInput = {
  walkthroughAt: null,
  proposalStatus: null,
  approvedAt: null,
  sentAt: null,
  views: [],
  respondedAt: null,
  expiresAt: null,
  unansweredQuestionAt: null,
};

describe("salesStage", () => {
  it("waits to be priced once the walkthrough is in, and says so after a day", () => {
    const s = salesStage({ ...base, walkthroughAt: "2026-10-02T15:00:00Z", proposalStatus: "needs_approval" }, now);
    expect(s.step).toBe(1);
    expect(s.issues[0]).toContain("2 days ago and not priced");
  });

  it("is ready to send once priced", () => {
    const s = salesStage({ ...base, walkthroughAt: "2026-10-03T15:00:00Z", approvedAt: "2026-10-04T12:00:00Z", proposalStatus: "sent" }, now);
    expect(s.step).toBe(2);
    expect(s.now).toBe("Priced, ready to send");
  });

  it("flags a proposal nobody has opened in two days", () => {
    const s = salesStage({ ...base, approvedAt: "2026-10-01T12:00:00Z", sentAt: "2026-10-02T12:00:00Z", proposalStatus: "sent" }, now);
    expect(s.step).toBe(3);
    expect(s.issues[0]).toContain("Not opened in 2 days");
  });

  it("counts opens after it was sent, not the office's previews before", () => {
    const s = salesStage(
      { ...base, approvedAt: "2026-10-01T12:00:00Z", sentAt: "2026-10-02T12:00:00Z", views: ["2026-10-01T13:00:00Z", "2026-10-03T09:00:00Z", "2026-10-04T09:00:00Z"], proposalStatus: "sent" },
      now
    );
    expect(s.step).toBe(4);
    expect(s.now).toBe("Opened 2 times, waiting on their answer");
    expect(s.issues).toEqual([]);
  });

  it("says follow up when opened and quiet for three days", () => {
    const s = salesStage({ ...base, sentAt: "2026-09-28T12:00:00Z", views: ["2026-09-30T12:00:00Z"], proposalStatus: "sent" }, now);
    expect(s.issues[0]).toContain("no answer in 4 days. Follow up.");
  });

  it("is urgent when the client asked a question or the price is about to run out", () => {
    const asked = salesStage({ ...base, sentAt: "2026-10-03T12:00:00Z", proposalStatus: "sent", unansweredQuestionAt: "2026-10-04T10:00:00Z" }, now);
    expect(asked.urgent).toBe(true);
    const expiring = salesStage({ ...base, sentAt: "2026-09-21T12:00:00Z", proposalStatus: "sent", expiresAt: "2026-10-05T12:00:00Z" }, now);
    expect(expiring.urgent).toBe(true);
    expect(expiring.issues[0]).toContain("runs out in 1 day");
  });

  it("ends on the answer", () => {
    expect(salesStage({ ...base, proposalStatus: "accepted", respondedAt: "2026-10-03T12:00:00Z" }, now).outcome).toBe("won");
    expect(salesStage({ ...base, proposalStatus: "declined" }, now).outcome).toBe("lost");
  });
});

describe("salesStepState", () => {
  it("fills the bar up to the step it is on", () => {
    const s = salesStage({ ...base, sentAt: "2026-10-04T12:00:00Z", proposalStatus: "sent" }, now);
    expect([0, 1, 2, 3, 4].map((i) => salesStepState(i, s))).toEqual(["done", "done", "done", "now", "todo"]);
  });
  it("marks the last step lost on a decline", () => {
    const s = salesStage({ ...base, proposalStatus: "declined" }, now);
    expect(salesStepState(4, s)).toBe("lost");
  });
});

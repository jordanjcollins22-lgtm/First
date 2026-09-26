import { describe, expect, it } from "vitest";

import { attentionReasons, wantsAttention, type AttentionFacts } from "./attention";
import type { Issue } from "./issues";

const NOW = "2026-09-08T12:00:00.000Z";

const facts = (over: Partial<AttentionFacts> = {}): AttentionFacts => ({
  status: "approved",
  startsOn: null,
  ready: true,
  completedAt: null,
  closeoutDone: false,
  balanceOutstanding: null,
  invoicedAt: null,
  financialDisposition: null,
  ...over,
});

const issue = (over: Partial<Issue>): Issue => ({
  id: "i",
  jobId: "j",
  customerId: null,
  propertyId: null,
  type: "material",
  severity: "blocking",
  title: "No mulch",
  description: null,
  status: "open",
  ownerId: null,
  ownerName: null,
  createdBy: null,
  createdByName: null,
  createdAt: "2026-09-01T09:00:00.000Z",
  dueAt: null,
  blocking: true,
  blockingStage: null,
  resolution: null,
  resolvedBy: null,
  resolvedByName: null,
  resolvedAt: null,
  ...over,
});

describe("issues put a job in Needs attention", () => {
  it("for a blocking issue", () => {
    expect(attentionReasons(facts(), [issue({})], NOW)[0].kind).toBe("blocking-issue");
  });

  it("for a critical one even where somebody said it does not stop the work", () => {
    const reasons = attentionReasons(facts(), [issue({ severity: "critical", blocking: false })], NOW);
    expect(reasons[0].kind).toBe("critical-issue");
  });

  it("and not for a resolved one", () => {
    expect(attentionReasons(facts(), [issue({ status: "resolved" })], NOW)).toEqual([]);
  });
});

describe("derived reasons, which nothing has to remember to close", () => {
  it("flags a job starting soon that is still not ready", () => {
    const reasons = attentionReasons(facts({ startsOn: "2026-09-10T08:00:00.000Z", ready: false }), [], NOW);
    expect(reasons[0].says).toBe("Starts in 2 days and is still not ready");
  });

  it("says today when it is today", () => {
    const reasons = attentionReasons(facts({ startsOn: "2026-09-08T20:00:00.000Z", ready: false }), [], NOW);
    expect(reasons[0].says).toBe("Starts today and is still not ready");
  });

  it("is harsher once the start date has gone by", () => {
    const reasons = attentionReasons(facts({ startsOn: "2026-09-05T08:00:00.000Z", ready: false }), [], NOW);
    expect(reasons[0].kind).toBe("confirmations-overdue");
    expect(reasons[0].says).toContain("3 days ago");
  });

  it("leaves a ready job alone however soon it starts", () => {
    expect(attentionReasons(facts({ startsOn: "2026-09-08T20:00:00.000Z", ready: true }), [], NOW)).toEqual([]);
  });

  it("does not call an unscheduled job late", () => {
    expect(attentionReasons(facts({ startsOn: null, ready: false }), [], NOW)).toEqual([]);
  });

  it("flags a closeout nobody has done a week after the work finished", () => {
    const reasons = attentionReasons(facts({ completedAt: "2026-08-25T09:00:00.000Z" }), [], NOW);
    expect(reasons.some((r) => r.kind === "closeout-overdue")).toBe(true);
  });

  it("gives closeout a few days before nagging", () => {
    const reasons = attentionReasons(facts({ completedAt: "2026-09-06T09:00:00.000Z" }), [], NOW);
    expect(reasons.some((r) => r.kind === "closeout-overdue")).toBe(false);
  });
});

describe("money after the work is finished", () => {
  it("keeps an unpaid completed job visible", () => {
    const reasons = attentionReasons(
      facts({ status: "completed", closeoutDone: true, balanceOutstanding: 800, invoicedAt: "2026-09-06T09:00:00.000Z" }),
      [],
      NOW
    );
    expect(reasons.some((r) => r.kind === "payment-overdue")).toBe(true);
  });

  it("says how long it has been once it is properly late", () => {
    const reasons = attentionReasons(
      facts({ status: "completed", closeoutDone: true, balanceOutstanding: 800, invoicedAt: "2026-08-01T09:00:00.000Z" }),
      [],
      NOW
    );
    expect(reasons.find((r) => r.kind === "payment-overdue")!.says).toContain("38 days after invoicing");
  });

  it("goes quiet once somebody records what is happening about it", () => {
    const reasons = attentionReasons(
      facts({
        status: "completed",
        closeoutDone: true,
        balanceOutstanding: 800,
        invoicedAt: "2026-08-01T09:00:00.000Z",
        financialDisposition: "payment_plan",
      }),
      [],
      NOW
    );
    expect(reasons).toEqual([]);
  });

  it("says nothing where there is no invoice, because nothing is known", () => {
    expect(attentionReasons(facts({ status: "completed", balanceOutstanding: null }), [], NOW)).toEqual([]);
  });
});

describe("the order they are read in", () => {
  it("puts what is stopping the job above what is merely late", () => {
    const reasons = attentionReasons(
      facts({ completedAt: "2026-08-01T09:00:00.000Z" }),
      [issue({})],
      NOW
    );
    expect(reasons.map((r) => r.kind)).toEqual(["blocking-issue", "closeout-overdue"]);
  });
});

describe("whether it belongs there at all", () => {
  it("is false for a quiet job", () => {
    expect(wantsAttention(facts(), [], NOW)).toBe(false);
  });

  it("is true on an issue alone", () => {
    expect(wantsAttention(facts(), [issue({})], NOW)).toBe(true);
  });

  it("is true on a derived reason alone", () => {
    expect(wantsAttention(facts({ startsOn: "2026-09-09T08:00:00.000Z", ready: false }), [], NOW)).toBe(true);
  });
});

describe("what the field has reported", () => {
  it("puts a stopped crew above everything else", () => {
    const reasons = attentionReasons(
      facts({ crewStopped: 1, openExceptions: 1, balanceOutstanding: 900, status: "completed" }),
      [issue({ severity: "critical", blocking: true })],
      NOW
    );
    expect(reasons[0].kind).toBe("crew-stopped");
    expect(reasons[0].says).toBe("A crew is stopped on site");
  });

  it("chases a change request nobody has picked up", () => {
    const reasons = attentionReasons(facts({ openExceptions: 1, changesAwaitingReview: 1 }), [], NOW);
    expect(reasons.map((r) => r.kind)).toContain("change-awaiting-review");
    // The one report and the one change are the same thing; it is not counted
    // twice under a second heading.
    expect(reasons.map((r) => r.kind)).not.toContain("exception-unanswered");
  });

  it("counts the reports that are neither a stopped crew nor a change", () => {
    const reasons = attentionReasons(facts({ openExceptions: 3, crewStopped: 1, changesAwaitingReview: 1 }), [], NOW);
    const other = reasons.find((r) => r.kind === "exception-unanswered");
    expect(other?.says).toBe("A field report has not been answered");
  });

  it("does not chase a change the client got this morning", () => {
    const reasons = attentionReasons(
      facts({ changesAwaitingClient: 1, oldestSentToClientAt: "2026-09-08T08:00:00.000Z" }),
      [],
      NOW
    );
    expect(reasons.map((r) => r.kind)).not.toContain("change-awaiting-client");
  });

  it("does chase one they have sat on for days", () => {
    const reasons = attentionReasons(
      facts({ changesAwaitingClient: 1, oldestSentToClientAt: "2026-09-01T08:00:00.000Z" }),
      [],
      NOW
    );
    expect(reasons.find((r) => r.kind === "change-awaiting-client")?.says).toBe(
      "A change request has been with the client 7 days"
    );
  });

  it("says nothing about a job with nothing reported", () => {
    expect(attentionReasons(facts(), [], NOW)).toEqual([]);
  });
});

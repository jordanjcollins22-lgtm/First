import { describe, expect, it } from "vitest";

import { jobsToMarkSold, soldLine, stageAfterPayment } from "./paid-job-stage";

describe("stageAfterPayment", () => {
  it("marks a quoted job sold, which is what a payment proves", () => {
    // The gap this exists for: the money was recorded and the card stayed in
    // Sales, quoted and apparently still waiting on a yes.
    expect(stageAfterPayment("estimating")).toBe("approved");
    expect(stageAfterPayment("lead")).toBe("approved");
  });

  it("does not move a job that is already further along", () => {
    expect(stageAfterPayment("in_progress")).toBeNull();
    expect(stageAfterPayment("completed")).toBeNull();
  });

  it("never reopens a cancelled job", () => {
    // A late payment or a refund landing against a cancelled job is a
    // conversation, not a reason to send a crew to an address.
    expect(stageAfterPayment("cancelled")).toBeNull();
  });

  it("leaves an already-sold job where it is", () => {
    expect(stageAfterPayment("approved")).toBeNull();
  });

  it("treats a status it has never seen as one worth moving", () => {
    expect(stageAfterPayment("something_new")).toBe("approved");
  });
});

describe("jobsToMarkSold", () => {
  it("picks out only the ones a payment should move", () => {
    const moved = jobsToMarkSold([
      { jobId: "a", status: "estimating" },
      { jobId: "b", status: "completed" },
      { jobId: "c", status: "cancelled" },
      { jobId: "d", status: "lead" },
    ]);
    expect(moved).toEqual(["a", "d"]);
  });

  it("moves nothing when there is nothing to move", () => {
    expect(jobsToMarkSold([{ jobId: "a", status: "approved" }])).toEqual([]);
    expect(jobsToMarkSold([])).toEqual([]);
  });
});

describe("soldLine", () => {
  it("says what moved and why", () => {
    expect(soldLine(4)).toBe("4 jobs moved to Operations, because they have been paid for");
    expect(soldLine(1)).toMatch(/^1 job moved/);
  });

  it("says nothing when nothing moved", () => {
    expect(soldLine(0)).toBeNull();
  });
});

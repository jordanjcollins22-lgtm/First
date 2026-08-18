import { describe, expect, it } from "vitest";

import {
  canCancelEstimate,
  canCancelJob,
  canCompleteJob,
  canReopenCompleted,
  canReopenJob,
  canRescheduleEstimate,
  canRescheduleJob,
  isClosed,
  statusAfterEstimateCancelled,
  statusAfterReopen,
  validateDateRange,
  type JobShape,
} from "@/lib/job-lifecycle";

function job(overrides: Partial<JobShape> = {}): JobShape {
  return {
    status: "estimating",
    evaluationStatus: "scheduled",
    evaluationDate: "2026-09-01",
    projectStartDate: null,
    projectEndDate: null,
    ...overrides,
  };
}

describe("canCancelEstimate", () => {
  it("allows cancelling a visit that hasn't happened", () => {
    expect(canCancelEstimate(job()).ok).toBe(true);
  });

  it("refuses when nothing is scheduled", () => {
    expect(canCancelEstimate(job({ evaluationDate: null })).ok).toBe(false);
  });

  it("refuses to erase a visit that already happened", () => {
    // The visit is a real event. Cancelling the job is the honest move.
    const verdict = canCancelEstimate(job({ evaluationStatus: "completed" }));
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/cancel the job/i);
  });

  it("refuses to cancel twice", () => {
    expect(canCancelEstimate(job({ evaluationStatus: "cancelled" })).ok).toBe(false);
  });
});

describe("canRescheduleEstimate", () => {
  it("moves a visit that is still ahead", () => {
    expect(canRescheduleEstimate(job()).ok).toBe(true);
  });

  it("re-books a cancelled visit", () => {
    // Cancelling shouldn't be a dead end — plans change back.
    expect(canRescheduleEstimate(job({ evaluationStatus: "cancelled" })).ok).toBe(true);
  });

  it("refuses on a cancelled job", () => {
    expect(canRescheduleEstimate(job({ status: "cancelled" })).ok).toBe(false);
  });

  it("refuses to move a visit that already happened", () => {
    expect(canRescheduleEstimate(job({ evaluationStatus: "completed" })).ok).toBe(false);
  });
});

describe("canCancelJob", () => {
  it("cancels live work", () => {
    expect(canCancelJob(job({ status: "in_progress" })).ok).toBe(true);
  });

  it("refuses to cancel finished work", () => {
    const verdict = canCancelJob(job({ status: "completed" }));
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/erase/i);
  });

  it("refuses to cancel twice", () => {
    expect(canCancelJob(job({ status: "cancelled" })).ok).toBe(false);
  });
});

describe("canReopenJob", () => {
  it("reopens a cancelled job", () => {
    expect(canReopenJob(job({ status: "cancelled" })).ok).toBe(true);
  });

  it("refuses on a job that was never cancelled", () => {
    expect(canReopenJob(job({ status: "approved" })).ok).toBe(false);
  });
});

describe("canRescheduleJob", () => {
  it("moves scheduled work", () => {
    expect(canRescheduleJob(job({ status: "approved", projectStartDate: "2026-09-10" })).ok).toBe(true);
  });

  it("refuses on cancelled and completed jobs", () => {
    expect(canRescheduleJob(job({ status: "cancelled" })).ok).toBe(false);
    expect(canRescheduleJob(job({ status: "completed" })).ok).toBe(false);
  });
});

describe("validateDateRange", () => {
  it("accepts a normal range", () => {
    expect(validateDateRange("2026-09-01", "2026-09-05").ok).toBe(true);
  });

  it("accepts a single day", () => {
    expect(validateDateRange("2026-09-01", "2026-09-01").ok).toBe(true);
  });

  it("accepts clearing both, which takes work off the calendar", () => {
    expect(validateDateRange(null, null).ok).toBe(true);
  });

  it("rejects an end before its start", () => {
    expect(validateDateRange("2026-09-10", "2026-09-02").ok).toBe(false);
  });

  it("rejects an end with no start", () => {
    expect(validateDateRange(null, "2026-09-02").ok).toBe(false);
  });
});

describe("statusAfterEstimateCancelled", () => {
  it("closes a job that was only ever an estimate", () => {
    expect(statusAfterEstimateCancelled("estimating")).toBe("cancelled");
  });

  it("leaves a quoted job alive — the proposal still stands", () => {
    expect(statusAfterEstimateCancelled("quoted")).toBe("quoted");
    expect(statusAfterEstimateCancelled("approved")).toBe("approved");
  });
});

describe("statusAfterReopen", () => {
  it("returns scheduled work to approved", () => {
    expect(statusAfterReopen({ evaluationStatus: "scheduled", projectStartDate: "2026-09-10" })).toBe("approved");
  });

  it("returns a finished estimate to quoted", () => {
    expect(statusAfterReopen({ evaluationStatus: "completed", projectStartDate: null })).toBe("quoted");
  });

  it("starts anything else over", () => {
    expect(statusAfterReopen({ evaluationStatus: "cancelled", projectStartDate: null })).toBe("estimating");
  });
});

describe("isClosed", () => {
  it("counts both endings", () => {
    expect(isClosed("completed")).toBe(true);
    expect(isClosed("cancelled")).toBe(true);
    expect(isClosed("in_progress")).toBe(false);
  });
});

describe("canCompleteJob", () => {
  const done = [{ kind: "after" as const }];

  it("signs off a job that has an after photo", () => {
    expect(canCompleteJob({ status: "in_progress" }, done).ok).toBe(true);
  });

  it("refuses with no photos at all", () => {
    const verdict = canCompleteJob({ status: "in_progress" }, []);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/after.*photo/i);
  });

  it("does not accept a before photo as proof the work got done", () => {
    // A before shot is worth having and is not evidence of anything finished.
    expect(canCompleteJob({ status: "in_progress" }, [{ kind: "before" }]).ok).toBe(false);
  });

  it("does not accept a photo of a problem as proof either", () => {
    expect(canCompleteJob({ status: "in_progress" }, [{ kind: "issue" }]).ok).toBe(false);
  });

  it("counts the after photo among others", () => {
    expect(
      canCompleteJob({ status: "in_progress" }, [{ kind: "before" }, { kind: "issue" }, { kind: "after" }]).ok
    ).toBe(true);
  });

  it("refuses to complete twice", () => {
    expect(canCompleteJob({ status: "completed" }, done).ok).toBe(false);
  });

  it("refuses on a cancelled job", () => {
    const verdict = canCompleteJob({ status: "cancelled" }, done);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/reopen/i);
  });
});

describe("canReopenCompleted", () => {
  it("reopens signed-off work for a callback", () => {
    expect(canReopenCompleted({ status: "completed" }).ok).toBe(true);
  });

  it("refuses on work that was never signed off", () => {
    expect(canReopenCompleted({ status: "in_progress" }).ok).toBe(false);
  });
});

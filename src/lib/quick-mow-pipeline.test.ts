import { describe, expect, it } from "vitest";

import { quickMowStage, QUICK_MOW_STAGES, type QuickMowFacts } from "@/lib/quick-mow-pipeline";

const base: QuickMowFacts = { orderStatus: "unpaid", calledAt: null, jobStatus: "estimating", visits: [] };

describe("where a quick mow request sits", () => {
  it("is a request until it is paid", () => {
    expect(quickMowStage(base)).toBe("requested");
    expect(quickMowStage({ ...base, jobStatus: null })).toBe("requested");
  });

  it("needs a call once paid", () => {
    expect(quickMowStage({ ...base, orderStatus: "paid", jobStatus: "approved" })).toBe("to_call");
  });

  it("needs a day once called", () => {
    expect(quickMowStage({ ...base, orderStatus: "paid", jobStatus: "approved", calledAt: "2026-10-02T15:00:00Z" })).toBe("to_schedule");
  });

  it("is scheduled once a visit is on the calendar, called or not", () => {
    expect(quickMowStage({ ...base, orderStatus: "paid", jobStatus: "approved", visits: [{ status: "scheduled" }] })).toBe("scheduled");
  });

  it("is mowed when the visit is done or the job is complete", () => {
    expect(quickMowStage({ ...base, orderStatus: "paid", jobStatus: "approved", visits: [{ status: "done" }] })).toBe("mowed");
    expect(quickMowStage({ ...base, orderStatus: "paid", jobStatus: "completed" })).toBe("mowed");
  });

  it("is lost when cancelled, whatever else is true", () => {
    expect(quickMowStage({ ...base, orderStatus: "cancelled" })).toBe("lost");
    expect(quickMowStage({ ...base, orderStatus: "paid", jobStatus: "cancelled", visits: [{ status: "scheduled" }] })).toBe("lost");
  });

  it("does not count a cancelled visit as scheduled", () => {
    expect(quickMowStage({ ...base, orderStatus: "paid", jobStatus: "approved", calledAt: "2026-10-02T15:00:00Z", visits: [{ status: "cancelled" }] })).toBe("to_schedule");
  });

  it("names every stage once", () => {
    expect(new Set(QUICK_MOW_STAGES.map((s) => s.key)).size).toBe(QUICK_MOW_STAGES.length);
  });
});

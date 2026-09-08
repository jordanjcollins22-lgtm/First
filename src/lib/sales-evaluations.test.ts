import { describe, expect, it } from "vitest";

import { bucketCounts, bucketOf, inBucket, type SalesEvaluation } from "./sales-evaluations";

const NOW = "2026-09-08T12:00:00.000Z";

const evaluation = (over: Partial<SalesEvaluation>): SalesEvaluation => ({
  jobId: "j",
  jobNumber: 1,
  customerName: "Ada",
  address: "1 Elm",
  at: "2026-09-10T09:00:00.000Z",
  evaluationStatus: "scheduled",
  status: "estimating",
  assignedToName: null,
  ...over,
});

describe("where an evaluation sits", () => {
  it("puts a future appointment in Coming up", () => {
    expect(bucketOf(evaluation({}), NOW)).toBe("booked");
  });

  it("puts a past appointment nobody closed in Past and not written up", () => {
    expect(bucketOf(evaluation({ at: "2026-09-01T09:00:00.000Z" }), NOW)).toBe("overdue");
  });

  it("puts a finished evaluation with no proposal in Done, no proposal yet", () => {
    expect(bucketOf(evaluation({ evaluationStatus: "completed" }), NOW)).toBe("awaiting-proposal");
  });

  it("drops it once a proposal exists, because it is the pipeline's now", () => {
    expect(bucketOf(evaluation({ evaluationStatus: "completed", status: "quoted" }), NOW)).toBeNull();
    expect(bucketOf(evaluation({ evaluationStatus: "completed", status: "approved" }), NOW)).toBeNull();
  });

  it("drops a cancelled one, either way it was cancelled", () => {
    expect(bucketOf(evaluation({ evaluationStatus: "cancelled" }), NOW)).toBeNull();
    expect(bucketOf(evaluation({ status: "cancelled" }), NOW)).toBeNull();
  });

  it("treats an unscheduled one as coming up rather than overdue", () => {
    expect(bucketOf(evaluation({ at: null }), NOW)).toBe("booked");
  });
});

describe("the list", () => {
  const rows = [
    evaluation({ jobId: "future" }),
    evaluation({ jobId: "old", at: "2026-09-01T09:00:00.000Z" }),
    evaluation({ jobId: "older", at: "2026-08-01T09:00:00.000Z" }),
    evaluation({ jobId: "done", evaluationStatus: "completed" }),
    evaluation({ jobId: "sold", status: "approved" }),
  ];

  it("leads with the one that has been waiting longest", () => {
    expect(inBucket(rows, "overdue", NOW).map((e) => e.jobId)).toEqual(["older", "old"]);
  });

  it("counts each bucket, and leaves the sold one out of all of them", () => {
    expect(bucketCounts(rows, NOW)).toEqual({ overdue: 2, booked: 1, "awaiting-proposal": 1 });
  });
});

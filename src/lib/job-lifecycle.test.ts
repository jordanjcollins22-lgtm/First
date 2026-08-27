import { describe, expect, it } from "vitest";

import {
  canCancelEstimate,
  canCancelJob,
  canCompleteJob,
  canReopenCompleted,
  canReopenJob,
  zoneCoverage,
  canRescheduleEstimate,
  canRescheduleJob,
  isClosed,
  statusAfterEstimateCancelled,
  statusAfterReopen,
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

describe("canCompleteJob with no zones drawn", () => {
  const after = [{ kind: "after" as const, zoneId: null }];

  it("refuses, because there is no such thing as a photo of a whole job", () => {
    // You cannot stand anywhere and capture an entire job. That is the whole
    // reason the work is divided into zones, so a job-wide shot cannot stand
    // in for zone documentation.
    const verdict = canCompleteJob({ status: "in_progress" }, after);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/draw the zones first/i);
  });

  it("refuses with nothing at all, for the same reason", () => {
    expect(canCompleteJob({ status: "in_progress" }, []).ok).toBe(false);
  });

  it("still reports a cancelled job as cancelled, not as missing zones", () => {
    const verdict = canCompleteJob({ status: "cancelled" }, after);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/reopen/i);
  });

  it("still reports an already-complete job as complete", () => {
    const verdict = canCompleteJob({ status: "completed" }, after);
    expect(verdict.ok === false && verdict.reason).toMatch(/already/i);
  });
});

describe("canCompleteJob per zone", () => {
  const zones = [
    { id: "z1", name: "Front bed" },
    { id: "z2", name: "Back patio" },
  ];

  function allThree(zoneId: string) {
    return [
      { kind: "before" as const, zoneId },
      { kind: "during" as const, zoneId },
      { kind: "after" as const, zoneId },
    ];
  }

  it("signs off when every zone has all three stages", () => {
    const photos = [...allThree("z1"), ...allThree("z2")];
    expect(canCompleteJob({ status: "in_progress" }, photos, zones).ok).toBe(true);
  });

  it("refuses when one zone is untouched, and names it", () => {
    const verdict = canCompleteJob({ status: "in_progress" }, allThree("z1"), zones);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain("Back patio");
  });

  it("names the exact stages a zone is missing", () => {
    const photos = [...allThree("z1"), { kind: "before" as const, zoneId: "z2" }];
    const verdict = canCompleteJob({ status: "in_progress" }, photos, zones);
    expect(verdict.ok === false && verdict.reason).toMatch(/during and after/i);
  });

  it("counts zones rather than listing them once more than one is short", () => {
    const verdict = canCompleteJob({ status: "in_progress" }, [], zones);
    expect(verdict.ok === false && verdict.reason).toMatch(/2 zones/);
  });

  it("does not let a job-wide photo cover a zone", () => {
    // The ambiguity per-zone documentation exists to remove.
    const photos = [
      ...allThree("z1"),
      { kind: "before" as const, zoneId: null },
      { kind: "during" as const, zoneId: null },
      { kind: "after" as const, zoneId: null },
    ];
    expect(canCompleteJob({ status: "in_progress" }, photos, zones).ok).toBe(false);
  });

  it("does not let one zone's photos cover another", () => {
    const photos = [...allThree("z1"), ...allThree("z1")];
    expect(canCompleteJob({ status: "in_progress" }, photos, zones).ok).toBe(false);
  });

  it("ignores an issue photo when deciding whether a stage is covered", () => {
    const photos = [
      { kind: "before" as const, zoneId: "z1" },
      { kind: "during" as const, zoneId: "z1" },
      { kind: "issue" as const, zoneId: "z1" },
      ...allThree("z2"),
    ];
    const verdict = canCompleteJob({ status: "in_progress" }, photos, zones);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/after/i);
  });
});

describe("zoneCoverage", () => {
  const zones = [{ id: "z1", name: "Front bed" }];

  it("reports every stage missing for an untouched zone", () => {
    const [coverage] = zoneCoverage(zones, []);
    expect(coverage.missing).toEqual(["before", "during", "after"]);
    expect(coverage.complete).toBe(false);
  });

  it("keeps the zone's name for display", () => {
    expect(zoneCoverage(zones, [])[0].zoneName).toBe("Front bed");
  });

  it("marks a zone complete once all three are in", () => {
    const [coverage] = zoneCoverage(zones, [
      { kind: "before", zoneId: "z1" },
      { kind: "during", zoneId: "z1" },
      { kind: "after", zoneId: "z1" },
    ]);
    expect(coverage.complete).toBe(true);
    expect(coverage.missing).toEqual([]);
  });

  it("does not double-count two photos of the same stage", () => {
    const [coverage] = zoneCoverage(zones, [
      { kind: "before", zoneId: "z1" },
      { kind: "before", zoneId: "z1" },
    ]);
    expect(coverage.missing).toEqual(["during", "after"]);
  });

  it("returns a row per zone even when nothing has been shot", () => {
    expect(zoneCoverage([{ id: "a", name: "A" }, { id: "b", name: "B" }], [])).toHaveLength(2);
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

describe("saying there isn't a photo", () => {
  const zones = [{ id: "z1", name: "Front bed" }];
  const before = { id: "p1", kind: "before" as const, zoneId: "z1" };
  const after = { id: "p2", kind: "after" as const, zoneId: "z1" };

  it("lets a waived stage count as covered", () => {
    const [coverage] = zoneCoverage(zones, [before, after], [{ zoneId: "z1", stage: "during" }]);
    expect(coverage.have.during).toBe(true);
    expect(coverage.missing).toEqual([]);
    expect(coverage.complete).toBe(true);
  });

  it("keeps a waiver distinguishable from a photograph", () => {
    // Both let the job close. One is a record of the work, the other is a
    // record of somebody saying there isn't one, and a sheet that cannot
    // tell them apart turns "we didn't take it" into "here it is".
    const [coverage] = zoneCoverage(zones, [before, after], [{ zoneId: "z1", stage: "during" }]);
    expect(coverage.waived.during).toBe(true);
    expect(coverage.waived.before).toBe(false);
  });

  it("lets a photo overrule a waiver once it turns up", () => {
    const during = { id: "p3", kind: "during" as const, zoneId: "z1" };
    const [coverage] = zoneCoverage(zones, [before, during, after], [
      { zoneId: "z1", stage: "during" },
    ]);
    expect(coverage.have.during).toBe(true);
    expect(coverage.waived.during).toBe(false);
  });

  it("waives one zone without waiving another", () => {
    // "No during shot of the back bed" says nothing about the front.
    const twoZones = [...zones, { id: "z2", name: "Back bed" }];
    const coverage = zoneCoverage(twoZones, [before, after], [{ zoneId: "z1", stage: "during" }]);
    expect(coverage[0].complete).toBe(true);
    expect(coverage[1].missing).toEqual(["before", "during", "after"]);
  });

  it("lets a job with a waived stage be signed off", () => {
    const verdict = canCompleteJob({ status: "in_progress" }, [before, after], zones, [
      { zoneId: "z1", stage: "during" },
    ]);
    expect(verdict.ok).toBe(true);
  });

  it("still blocks a stage nobody photographed or waived", () => {
    const verdict = canCompleteJob({ status: "in_progress" }, [before, after], zones);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("Front bed");
  });

  it("ignores a waiver for a zone that is not there", () => {
    const coverage = zoneCoverage(zones, [before, after], [{ zoneId: "gone", stage: "during" }]);
    expect(coverage[0].missing).toEqual(["during"]);
  });
});

import { describe, expect, it } from "vitest";

import {
  blocksByDefault,
  blockingIssues,
  blockingStage,
  isBlockingStage,
  isIssueType,
  isSeverity,
  needsAttention,
  sortIssues,
  summarise,
  worstOpen,
  type Issue,
} from "./issues";

const issue = (over: Partial<Issue>): Issue => ({
  id: "i",
  jobId: "j",
  customerId: null,
  propertyId: null,
  type: "material",
  severity: "warning",
  title: "Mulch short",
  description: null,
  status: "open",
  ownerId: null,
  ownerName: null,
  createdBy: null,
  createdByName: null,
  createdAt: "2026-09-01T09:00:00.000Z",
  dueAt: null,
  blocking: false,
  blockingStage: null,
  resolution: null,
  resolvedBy: null,
  resolvedByName: null,
  resolvedAt: null,
  ...over,
});

describe("what stops the work", () => {
  it("stops it for blocking and critical, and not for a note or a warning", () => {
    expect(blocksByDefault("blocking")).toBe(true);
    expect(blocksByDefault("critical")).toBe(true);
    expect(blocksByDefault("warning")).toBe(false);
    expect(blocksByDefault("info")).toBe(false);
  });

  it("lets a person overrule the default, because the record shows they did", () => {
    // A warning somebody decided really does stop the job.
    expect(blockingIssues([issue({ severity: "warning", blocking: true })])).toHaveLength(1);
    // And a critical one somebody decided does not.
    expect(blockingIssues([issue({ severity: "critical", blocking: false })])).toHaveLength(0);
  });

  it("stops counting an issue once it is resolved", () => {
    expect(blockingIssues([issue({ blocking: true, status: "resolved" })])).toHaveLength(0);
    expect(blockingIssues([issue({ blocking: true, status: "cancelled" })])).toHaveLength(0);
  });
});

describe("which gate an issue holds", () => {
  const issues = [
    issue({ id: "any", blocking: true, blockingStage: null }),
    issue({ id: "ready", blocking: true, blockingStage: "ready" }),
    issue({ id: "close", blocking: true, blockingStage: "closeout" }),
  ];

  it("holds every gate when no stage is named", () => {
    expect(blockingStage(issues, "start").map((i) => i.id)).toEqual(["any"]);
  });

  it("holds only its own stage when one is named", () => {
    expect(blockingStage(issues, "ready").map((i) => i.id)).toEqual(["any", "ready"]);
    expect(blockingStage(issues, "closeout").map((i) => i.id)).toEqual(["any", "close"]);
  });
});

describe("needs attention", () => {
  it("is derived, so a job leaves it the moment the issue is resolved", () => {
    const open = [issue({ blocking: true })];
    expect(needsAttention(open)).toBe(true);
    expect(needsAttention([issue({ blocking: true, status: "resolved" })])).toBe(false);
  });

  it("takes a critical issue even where somebody said it does not stop the work", () => {
    expect(needsAttention([issue({ severity: "critical", blocking: false })])).toBe(true);
  });

  it("does not drag a job in for a note or an ordinary warning", () => {
    expect(needsAttention([issue({ severity: "info" }), issue({ severity: "warning" })])).toBe(false);
  });

  it("is false when there is nothing open at all", () => {
    expect(needsAttention([])).toBe(false);
  });
});

describe("the order they are read in", () => {
  it("puts the worst open one first, then the oldest", () => {
    const rows = [
      issue({ id: "warn", severity: "warning" }),
      issue({ id: "crit", severity: "critical" }),
      issue({ id: "old-warn", severity: "warning", createdAt: "2026-08-01T09:00:00.000Z" }),
    ];
    expect(sortIssues(rows).map((i) => i.id)).toEqual(["crit", "old-warn", "warn"]);
  });

  it("sinks anything already dealt with", () => {
    const rows = [
      issue({ id: "done", severity: "critical", status: "resolved" }),
      issue({ id: "open", severity: "info" }),
    ];
    expect(sortIssues(rows).map((i) => i.id)).toEqual(["open", "done"]);
  });

  it("does not reorder the array it was given", () => {
    const rows = [issue({ id: "b", severity: "warning" }), issue({ id: "a", severity: "critical" })];
    sortIssues(rows);
    expect(rows.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("the badge and the sentence", () => {
  it("reports the worst thing still open", () => {
    expect(worstOpen([issue({ severity: "warning" }), issue({ severity: "critical" })])).toBe("critical");
    expect(worstOpen([issue({ severity: "critical", status: "resolved" })])).toBeNull();
    expect(worstOpen([])).toBeNull();
  });

  it("says nothing when nothing is open", () => {
    expect(summarise([])).toBeNull();
  });

  it("says how many are stopping the job", () => {
    expect(summarise([issue({ blocking: true }), issue({ blocking: true })])).toBe(
      "2 issues are stopping this job."
    );
  });

  it("counts the rest separately, so a warning is not mistaken for a blocker", () => {
    expect(summarise([issue({ blocking: true }), issue({ severity: "info" })])).toBe(
      "1 issue is stopping this job, and 1 other open issue."
    );
  });

  it("says so plainly when nothing open is stopping anything", () => {
    expect(summarise([issue({ severity: "warning" })])).toBe(
      "1 open issue, none of them stopping the work."
    );
  });
});

describe("what a typed value is allowed to be", () => {
  it("refuses anything not in the list, so a URL cannot invent a severity", () => {
    expect(isIssueType("material")).toBe(true);
    expect(isIssueType("MATERIAL")).toBe(false);
    expect(isSeverity("blocking")).toBe(true);
    expect(isSeverity("catastrophic")).toBe(false);
    expect(isBlockingStage("ready")).toBe(true);
    expect(isBlockingStage("whenever")).toBe(false);
  });
});

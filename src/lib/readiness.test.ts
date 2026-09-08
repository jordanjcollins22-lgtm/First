import { describe, expect, it } from "vitest";

import type { Issue } from "./issues";
import {
  evaluateGate,
  gatesUpTo,
  isReady,
  readinessLine,
  type GateOverride,
  type JobFacts,
} from "./readiness";

const READY_FACTS: JobFacts = {
  status: "approved",
  proposalAccepted: true,
  depositSatisfied: true,
  scheduled: true,
  crewAssigned: true,
  workOrderReady: true,
  materialsConfirmed: true,
  accessConfirmed: true,
  measurementsPresent: true,
  scopeDocumented: true,
  beforePhotos: 2,
  afterPhotos: 0,
  walkthroughDone: false,
  invoiceRaised: false,
  balanceOutstanding: null,
};

const facts = (over: Partial<JobFacts> = {}): JobFacts => ({ ...READY_FACTS, ...over });

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

const override = (over: Partial<GateOverride>): GateOverride => ({
  checkKey: "materials",
  reason: "Client is supplying the mulch",
  byId: "u1",
  byName: "Jordan",
  at: "2026-09-08T07:40:00.000Z",
  ...over,
});

describe("a gate explains itself", () => {
  it("returns every check, passed and failed, not a yes or a no", () => {
    const result = evaluateGate("ready", facts({ materialsConfirmed: false }));
    expect(result.checks.length).toBeGreaterThan(3);
    expect(result.checks.some((c) => c.passed)).toBe(true);
    expect(result.checks.some((c) => !c.passed)).toBe(true);
  });

  it("says what would fix a failed check", () => {
    const result = evaluateGate("ready", facts({ crewAssigned: false }));
    const crew = result.checks.find((c) => c.key === "crew")!;
    expect(crew.passed).toBe(false);
    expect(crew.reason).toContain("Plan tab");
  });

  it("opens when every blocking check passes", () => {
    expect(evaluateGate("ready", facts()).open).toBe(true);
  });
});

describe("what blocks and what only warns", () => {
  it("stops the job when a blocking check fails", () => {
    const result = evaluateGate("ready", facts({ materialsConfirmed: false }));
    expect(result.open).toBe(false);
    expect(result.stoppers.map((c) => c.key)).toEqual(["materials"]);
  });

  it("opens anyway when only a warning fails, and still says so", () => {
    const result = evaluateGate("ready", facts({ workOrderReady: false }));
    expect(result.open).toBe(true);
    expect(result.warnings.map((c) => c.key)).toEqual(["work-order"]);
    expect(result.stoppers).toEqual([]);
  });

  it("does not hold a job for money it is not owed", () => {
    const result = evaluateGate("completed", facts({ afterPhotos: 1, invoiceRaised: true, balanceOutstanding: null }));
    expect(result.open).toBe(true);
  });

  it("warns about an unpaid balance rather than refusing to close the work", () => {
    const result = evaluateGate("completed", facts({ afterPhotos: 1, invoiceRaised: true, balanceOutstanding: 400 }));
    expect(result.open).toBe(true);
    expect(result.warnings.map((c) => c.key)).toContain("balance");
  });
});

describe("an override", () => {
  const failing = facts({ materialsConfirmed: false });

  it("lets the gate open without the check ever reading as passed", () => {
    const result = evaluateGate("ready", failing, [], [override({})]);
    const materials = result.checks.find((c) => c.key === "materials")!;
    expect(result.open).toBe(true);
    expect(materials.passed).toBe(false);
    expect(materials.stopping).toBe(false);
  });

  it("keeps who, when and why against the check it covers", () => {
    const result = evaluateGate("ready", failing, [], [override({})]);
    const materials = result.checks.find((c) => c.key === "materials")!;
    expect(materials.override).toMatchObject({
      byName: "Jordan",
      reason: "Client is supplying the mulch",
      at: "2026-09-08T07:40:00.000Z",
      checkKey: "materials",
    });
  });

  it("covers only the check it names", () => {
    const result = evaluateGate("ready", facts({ materialsConfirmed: false, crewAssigned: false }), [], [override({})]);
    expect(result.open).toBe(false);
    expect(result.stoppers.map((c) => c.key)).toEqual(["crew"]);
  });

  it("does nothing to a check that was passing anyway", () => {
    const result = evaluateGate("ready", facts(), [], [override({ checkKey: "crew" })]);
    expect(result.open).toBe(true);
    expect(result.checks.find((c) => c.key === "crew")!.passed).toBe(true);
  });
});

describe("issues hold gates too", () => {
  it("holds the gate shut while a blocking issue is open", () => {
    const result = evaluateGate("ready", facts(), [issue({})]);
    expect(result.open).toBe(false);
    expect(result.blockingIssues).toHaveLength(1);
  });

  it("opens once the issue is resolved, with nothing to un-set", () => {
    expect(evaluateGate("ready", facts(), [issue({ status: "resolved" })]).open).toBe(true);
  });

  it("only holds the gate the issue names", () => {
    expect(evaluateGate("ready", facts(), [issue({ blockingStage: "closeout" })]).open).toBe(true);
    expect(evaluateGate("closeout", facts({ afterPhotos: 1 }), [issue({ blockingStage: "closeout" })]).open).toBe(false);
  });

  it("is not held by an issue somebody said does not stop the work", () => {
    expect(evaluateGate("ready", facts(), [issue({ blocking: false })]).open).toBe(true);
  });

  it("cannot be overridden away — an override covers a check, not an issue", () => {
    const result = evaluateGate("ready", facts(), [issue({})], [override({ checkKey: "materials" })]);
    expect(result.open).toBe(false);
  });
});

describe("Ready, as the job board means it", () => {
  it("is sold work with every blocking pre-start check passing", () => {
    expect(isReady(facts(), [], [])).toBe(true);
  });

  it("is never true for work that has not been sold", () => {
    expect(isReady(facts({ status: "estimating" }), [], [])).toBe(false);
    expect(isReady(facts({ status: "in_progress" }), [], [])).toBe(false);
  });

  it("is false while anything blocking is failing", () => {
    expect(isReady(facts({ accessConfirmed: false }), [], [])).toBe(false);
  });

  it("becomes true on an override, without the check being altered", () => {
    expect(isReady(facts({ accessConfirmed: false }), [], [override({ checkKey: "access" })])).toBe(true);
  });
});

describe("the one-line version", () => {
  it("says Ready when it is", () => {
    expect(readinessLine(evaluateGate("ready", facts()))).toBe("Ready");
  });

  it("counts the failing checks and the blocking issues separately", () => {
    const result = evaluateGate("ready", facts({ crewAssigned: false, materialsConfirmed: false }), [issue({})]);
    expect(readinessLine(result)).toBe("2 checks failing, 1 blocking issue");
  });
});

describe("the order of the gates", () => {
  it("carries every earlier gate", () => {
    expect(gatesUpTo("ready")).toEqual(["proposal", "booking", "ready"]);
    expect(gatesUpTo("proposal")).toEqual(["proposal"]);
  });
});

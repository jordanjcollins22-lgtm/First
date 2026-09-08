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

/** A job with everything actually confirmed — not merely uncomplained-about. */
const READY_FACTS: JobFacts = {
  status: "approved",
  proposalAccepted: true,

  measurementRequired: true,
  measurementsPresent: true,
  scopeDocumented: true,

  scheduled: true,
  crewAssigned: true,
  workOrderReady: true,

  materials: "confirmed",
  materialsSource: "In stock",
  equipment: "confirmed",
  equipmentSource: "In stock",
  access: "confirmed",
  accessSource: "Gate code on file",

  depositRequiredCents: 0,
  depositReceivedCents: 0,

  beforePhotos: 2,
  afterPhotos: 0,
  walkthroughDone: false,
  invoiceRaised: false,
  balanceOutstanding: null,
  financialDisposition: null,
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

const check = (result: ReturnType<typeof evaluateGate>, key: string) =>
  result.checks.find((c) => c.key === key);

describe("unknown is not confirmed", () => {
  it("fails Ready when nobody has confirmed the materials", () => {
    const result = evaluateGate("ready", facts({ materials: "required_unconfirmed" }));
    expect(result.open).toBe(false);
    expect(check(result, "materials")!.state).toBe("failed");
  });

  it("fails Ready when nobody has confirmed the equipment", () => {
    expect(evaluateGate("ready", facts({ equipment: "required_unconfirmed" })).open).toBe(false);
  });

  it("fails Ready when nobody has recorded how to get onto the property", () => {
    const result = evaluateGate("ready", facts({ access: "required_unconfirmed" }));
    expect(result.open).toBe(false);
    expect(result.stoppers.map((c) => c.key)).toEqual(["access"]);
  });

  it("never passes a confirmation because no issue was raised", () => {
    // The old bug: an empty issue list used to mean "fine". It now means
    // nothing at all, and the confirmation state is what decides.
    const result = evaluateGate("ready", facts({ materials: "required_unconfirmed" }), []);
    expect(result.open).toBe(false);
  });

  it("says where the answer came from, so nobody has to guess what proved it", () => {
    const result = evaluateGate("ready", facts({ materialsSource: "In stock or on order: Mulch" }));
    expect(check(result, "materials")!.source).toBe("In stock or on order: Mulch");
  });
});

describe("a check the job does not need is not a check", () => {
  it("drops the materials check entirely when no service needs any", () => {
    const result = evaluateGate("ready", facts({ materials: "not_required" }));
    expect(check(result, "materials")).toBeUndefined();
    expect(result.open).toBe(true);
  });

  it("does not ask a bush trim for a square-foot measurement", () => {
    const result = evaluateGate("proposal", facts({ measurementRequired: false, measurementsPresent: false }));
    expect(check(result, "measurements")).toBeUndefined();
    expect(result.open).toBe(true);
  });

  it("still asks for it where a service is priced by measurement", () => {
    const result = evaluateGate("proposal", facts({ measurementRequired: true, measurementsPresent: false }));
    expect(check(result, "measurements")!.state).toBe("failed");
    expect(result.open).toBe(false);
  });

  it("drops the deposit check when the job requires no money up front", () => {
    const result = evaluateGate("ready", facts({ depositRequiredCents: 0 }));
    expect(check(result, "deposit")).toBeUndefined();
  });
});

describe("payment comes from the money, not from silence", () => {
  it("fails when the deposit is short", () => {
    const result = evaluateGate("ready", facts({ depositRequiredCents: 50_000, depositReceivedCents: 20_000 }));
    expect(result.open).toBe(false);
    expect(check(result, "deposit")!.reason).toContain("$300");
  });

  it("passes once enough has actually been received", () => {
    const result = evaluateGate("ready", facts({ depositRequiredCents: 50_000, depositReceivedCents: 50_000 }));
    expect(check(result, "deposit")!.state).toBe("passed");
    expect(result.open).toBe(true);
  });

  it("passes when more than enough came in", () => {
    const result = evaluateGate("ready", facts({ depositRequiredCents: 50_000, depositReceivedCents: 90_000 }));
    expect(check(result, "deposit")!.state).toBe("passed");
  });
});

describe("what blocks and what only warns", () => {
  it("opens anyway when only a warning fails, and still says so", () => {
    const result = evaluateGate("ready", facts({ workOrderReady: false }));
    expect(result.open).toBe(true);
    expect(result.warnings.map((c) => c.key)).toEqual(["work-order"]);
  });

  it("does not hold Fully closed shut over an unpaid balance", () => {
    // The landscaping really is finished. The money is chased through Needs
    // attention, not by refusing to close the work.
    const result = evaluateGate(
      "completed",
      facts({ afterPhotos: 1, invoiceRaised: true, balanceOutstanding: 800, walkthroughDone: true })
    );
    expect(result.open).toBe(true);
    expect(check(result, "balance")).toBeUndefined();
  });

  it("keeps money out of Field work complete altogether", () => {
    const result = evaluateGate("closeout", facts({ afterPhotos: 1 }));
    expect(result.checks.map((c) => c.key)).toEqual(["after-photos", "walkthrough"]);
  });
});

describe("an override", () => {
  const unconfirmed = facts({ materials: "required_unconfirmed" });

  it("lets the gate open without the check ever reading as passed", () => {
    const result = evaluateGate("ready", unconfirmed, [], [override({})]);
    expect(result.open).toBe(true);
    expect(check(result, "materials")!.passed).toBe(false);
    expect(check(result, "materials")!.state).toBe("overridden");
  });

  it("keeps who, when and why against the check it covers", () => {
    const result = evaluateGate("ready", unconfirmed, [], [override({})]);
    expect(check(result, "materials")!.override).toMatchObject({
      byName: "Jordan",
      reason: "Client is supplying the mulch",
      at: "2026-09-08T07:40:00.000Z",
      checkKey: "materials",
    });
  });

  it("covers only the check it names", () => {
    const result = evaluateGate(
      "ready",
      facts({ materials: "required_unconfirmed", crewAssigned: false }),
      [],
      [override({})]
    );
    expect(result.open).toBe(false);
    expect(result.stoppers.map((c) => c.key)).toEqual(["crew"]);
  });
});

describe("a confirmation and a later problem are both true", () => {
  it("stops a confirmed job the moment a blocking issue opens", () => {
    // Materials confirmed on Tuesday; the supplier rings on Wednesday.
    const result = evaluateGate("ready", facts({ materials: "confirmed" }), [issue({ type: "material" })]);
    expect(result.open).toBe(false);
    expect(result.blockingIssues).toHaveLength(1);
  });

  it("does not erase the confirmation to do it", () => {
    const result = evaluateGate("ready", facts({ materials: "confirmed" }), [issue({ type: "material" })]);
    expect(check(result, "materials")!.state).toBe("passed");
  });

  it("opens again once the issue is resolved, with nothing to un-set", () => {
    expect(evaluateGate("ready", facts(), [issue({ status: "resolved" })]).open).toBe(true);
  });

  it("cannot be overridden away — an override covers a check, not an issue", () => {
    const result = evaluateGate("ready", facts(), [issue({})], [override({ checkKey: "materials" })]);
    expect(result.open).toBe(false);
  });

  it("only holds the gate the issue names", () => {
    expect(evaluateGate("ready", facts(), [issue({ blockingStage: "closeout" })]).open).toBe(true);
  });
});

describe("Ready, as the job board means it", () => {
  it("is sold work with every applicable blocking check passing", () => {
    expect(isReady(facts(), [], [])).toBe(true);
  });

  it("is never true for work that has not been sold", () => {
    expect(isReady(facts({ status: "estimating" }), [], [])).toBe(false);
    expect(isReady(facts({ status: "in_progress" }), [], [])).toBe(false);
  });

  it("is false while anything is merely unconfirmed", () => {
    expect(isReady(facts({ access: "required_unconfirmed" }), [], [])).toBe(false);
    expect(isReady(facts({ materials: "required_unconfirmed" }), [], [])).toBe(false);
    expect(isReady(facts({ equipment: "required_unconfirmed" }), [], [])).toBe(false);
  });

  it("is false while a job is unscheduled", () => {
    expect(isReady(facts({ scheduled: false }), [], [])).toBe(false);
  });

  it("becomes true on an override, without the check being altered", () => {
    expect(isReady(facts({ access: "required_unconfirmed" }), [], [override({ checkKey: "access" })])).toBe(true);
  });
});

describe("the one-line version", () => {
  it("says Ready when it is", () => {
    expect(readinessLine(evaluateGate("ready", facts()))).toBe("Ready");
  });

  it("counts the failing checks and the blocking issues separately", () => {
    const result = evaluateGate(
      "ready",
      facts({ crewAssigned: false, materials: "required_unconfirmed" }),
      [issue({})]
    );
    expect(readinessLine(result)).toBe("2 checks failing, 1 blocking issue");
  });
});

describe("the order of the gates", () => {
  it("carries every earlier gate", () => {
    expect(gatesUpTo("ready")).toEqual(["proposal", "booking", "ready"]);
  });
});

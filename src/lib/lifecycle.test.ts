import { describe, expect, it } from "vitest";

import { attentionReasons, wantsAttention, type AttentionFacts } from "./attention";
import { blocksByDefault, needsAttention, type Issue } from "./issues";
import { evaluateGate, isReady, type GateOverride, type JobFacts } from "./readiness";
import { netAppliedToJob, type Adjustment, type Receipt } from "./payments-net";
import { navModules, subtabsFor } from "./modules";

/**
 * One job, all the way through.
 *
 * Lead → evaluation → proposal → accepted → scheduled → not ready → ready →
 * start → issue → resolve → field complete → invoice → completed → unpaid →
 * disposition. Each step asserts what the app would actually show, so a change
 * that quietly lets a job skip a step fails here rather than in a garden.
 */

const NOW = "2026-09-08T12:00:00.000Z";
const JOB = "job-1";

const blank: JobFacts = {
  status: "estimating",
  servicesDefined: false,
  servicesSource: "Nothing on the scope",
  proposalAccepted: false,
  proposalSource: "No proposal record",
  measurementRequired: false,
  measurementsPresent: false,
  scheduled: false,
  crewAssigned: false,
  workOrderReady: false,
  workOrderSource: "No date or services",
  materials: "required_unconfirmed",
  materialsSource: "Not worked out",
  equipment: "required_unconfirmed",
  equipmentSource: "Not worked out",
  access: "required_unconfirmed",
  accessSource: "Nobody has recorded it",
  depositRequiredCents: 50_000,
  depositReceivedCents: 0,
  depositSource: "Net of refunds",
  evaluationPhotos: 0,
  preworkPhotos: 0,
  afterPhotos: 0,
  walkthroughDone: false,
  invoiceRaised: false,
  balanceOutstanding: null,
  financialDisposition: null,
};

const issue = (over: Partial<Issue>): Issue => ({
  id: "i1",
  jobId: JOB,
  customerId: null,
  propertyId: null,
  type: "material",
  severity: "blocking",
  title: "Mulch delayed",
  description: null,
  status: "open",
  ownerId: null,
  ownerName: null,
  createdBy: null,
  createdByName: null,
  createdAt: "2026-09-07T09:00:00.000Z",
  dueAt: null,
  blocking: true,
  blockingStage: null,
  resolution: null,
  resolvedBy: null,
  resolvedByName: null,
  resolvedAt: null,
  ...over,
});

const attention = (over: Partial<AttentionFacts> = {}): AttentionFacts => ({
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

describe("one job, all the way through", () => {
  it("1. a lead with nothing on it cannot be quoted", () => {
    const result = evaluateGate("proposal", blank);
    expect(result.open).toBe(false);
    expect(result.stoppers.map((c) => c.key)).toContain("services");
  });

  it("2. once the evaluation describes the work, quoting is possible", () => {
    const evaluated: JobFacts = {
      ...blank,
      servicesDefined: true,
      measurementRequired: true,
      measurementsPresent: true,
      evaluationPhotos: 4,
    };
    expect(evaluateGate("proposal", evaluated).open).toBe(true);
  });

  it("3. accepted but unpaid cannot be booked", () => {
    const accepted: JobFacts = { ...blank, servicesDefined: true, proposalAccepted: true };
    const result = evaluateGate("booking", accepted);
    expect(result.open).toBe(false);
    expect(result.stoppers.map((c) => c.key)).toEqual(["deposit"]);
  });

  it("4. the deposit landing opens booking", () => {
    const paid: JobFacts = {
      ...blank,
      servicesDefined: true,
      proposalAccepted: true,
      depositReceivedCents: netAppliedToJob(
        JOB,
        [{ id: "p1", jobId: JOB, amountCents: 50_000, receivedAt: "2026-09-02T10:00:00.000Z" }] as Receipt[],
        [] as Adjustment[]
      ),
    };
    expect(evaluateGate("booking", paid).open).toBe(true);
  });

  const sold: JobFacts = {
    ...blank,
    status: "approved",
    servicesDefined: true,
    proposalAccepted: true,
    depositReceivedCents: 50_000,
    measurementRequired: true,
    measurementsPresent: true,
    evaluationPhotos: 4,
  };

  it("5. scheduled is not ready: the confirmations are still missing", () => {
    const scheduled: JobFacts = { ...sold, scheduled: true, crewAssigned: true, workOrderReady: true };
    expect(isReady(scheduled, [], [])).toBe(false);
    const stoppers = evaluateGate("ready", scheduled).stoppers.map((c) => c.key);
    expect(stoppers).toEqual(["materials", "equipment", "access"]);
  });

  const ready: JobFacts = {
    ...sold,
    scheduled: true,
    crewAssigned: true,
    workOrderReady: true,
    materials: "confirmed",
    equipment: "confirmed",
    access: "confirmed",
  };

  it("6. confirming all three makes it ready", () => {
    expect(isReady(ready, [], [])).toBe(true);
  });

  it("7. a new blocking issue removes Ready at once", () => {
    expect(isReady(ready, [issue({})], [])).toBe(false);
    expect(needsAttention([issue({})])).toBe(true);
  });

  it("8. and resolving it gives Ready back, with nothing to un-set", () => {
    expect(isReady(ready, [issue({ status: "resolved" })], [])).toBe(true);
  });

  it("9. starting needs photos of the site as the crew found it", () => {
    expect(evaluateGate("start", ready).open).toBe(false);
    expect(evaluateGate("start", { ...ready, preworkPhotos: 2 }).open).toBe(true);
  });

  it("10. field work is complete on the after photos, and money is not asked about", () => {
    const working: JobFacts = { ...ready, status: "in_progress", preworkPhotos: 2 };
    expect(evaluateGate("closeout", working).open).toBe(false);
    const done = evaluateGate("closeout", { ...working, afterPhotos: 3 });
    expect(done.open).toBe(true);
    expect(done.checks.map((c) => c.key)).not.toContain("deposit");
  });

  it("11. fully closed needs the invoice raised", () => {
    const finished: JobFacts = { ...ready, status: "in_progress", preworkPhotos: 2, afterPhotos: 3 };
    expect(evaluateGate("completed", finished).open).toBe(false);
    expect(evaluateGate("completed", { ...finished, invoiceRaised: true }).open).toBe(true);
  });

  it("12. an unpaid balance does not stop it closing, but does not vanish either", () => {
    const closed: JobFacts = {
      ...ready,
      status: "completed",
      preworkPhotos: 2,
      afterPhotos: 3,
      invoiceRaised: true,
      balanceOutstanding: 120_000,
    };
    expect(evaluateGate("completed", closed).open).toBe(true);
    const reasons = attentionReasons(
      attention({ status: "completed", closeoutDone: true, balanceOutstanding: 120_000, invoicedAt: "2026-09-06T09:00:00.000Z" }),
      [],
      NOW
    );
    expect(reasons.map((r) => r.kind)).toContain("payment-overdue");
  });

  it("13. and goes quiet only once somebody records what happens about it", () => {
    const reasons = attentionReasons(
      attention({
        status: "completed",
        closeoutDone: true,
        balanceOutstanding: 120_000,
        invoicedAt: "2026-09-06T09:00:00.000Z",
        financialDisposition: "payment_plan",
      }),
      [],
      NOW
    );
    expect(reasons).toEqual([]);
  });
});

describe("an override moves a job without lying about why", () => {
  const stuck: JobFacts = {
    ...blank,
    status: "approved",
    servicesDefined: true,
    proposalAccepted: true,
    depositReceivedCents: 50_000,
    scheduled: true,
    crewAssigned: true,
    materials: "confirmed",
    equipment: "confirmed",
    access: "required_unconfirmed",
  };
  const letPast: GateOverride[] = [
    { checkKey: "access", reason: "Client rang, side gate open", byId: "u1", byName: "Jordan", at: NOW },
  ];

  it("opens the gate", () => {
    expect(isReady(stuck, [], letPast)).toBe(true);
  });

  it("without the check ever reading as passed", () => {
    const check = evaluateGate("ready", stuck, [], letPast).checks.find((c) => c.key === "access")!;
    expect(check.passed).toBe(false);
    expect(check.state).toBe("overridden");
    expect(check.override!.byName).toBe("Jordan");
  });

  it("and cannot be used on an issue", () => {
    expect(isReady(stuck, [issue({})], letPast)).toBe(false);
  });
});

describe("what each kind of person can open", () => {
  const modulesFor = (allowed: string[]) => navModules(allowed).map((m) => m.key);

  it("a field crew member gets their own day and nothing else", () => {
    expect(modulesFor([])).toEqual(["my-day"]);
  });

  it("an account manager gets selling and the calendar, not the money", () => {
    const keys = modulesFor(["pipeline", "contacts", "proposals", "evaluations", "job-detail"]);
    expect(keys).toEqual(["my-day", "sales", "schedule", "jobs"]);
    expect(subtabsFor("more", ["pipeline", "contacts"])).toEqual([]);
  });

  it("a manager who can see jobs gets the board", () => {
    expect(modulesFor(["job-detail"])).toEqual(["my-day", "jobs"]);
  });

  it("a money-trusted role gets Finance under More and nothing else there", () => {
    expect(subtabsFor("more", ["payments"]).map((s) => s.key)).toEqual(["finance"]);
  });

  it("severity still decides whether an issue stops the work by default", () => {
    expect(blocksByDefault("critical")).toBe(true);
    expect(blocksByDefault("warning")).toBe(false);
  });

  it("a job with nothing wrong is in nobody's Needs attention", () => {
    expect(wantsAttention(attention(), [], NOW)).toBe(false);
  });
});

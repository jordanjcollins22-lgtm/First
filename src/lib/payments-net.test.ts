import { describe, expect, it } from "vitest";

import {
  describeNet,
  depositSatisfied,
  isAdjustmentKind,
  netAppliedToJob,
  netOfReceipt,
  type Adjustment,
  type Receipt,
} from "./payments-net";
import { evaluateGate, type JobFacts } from "./readiness";

const JOB = "job-1";
const OTHER = "job-2";
const DEPOSIT = 50_000;

const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  id: "p1",
  jobId: JOB,
  amountCents: DEPOSIT,
  receivedAt: "2026-09-01T10:00:00.000Z",
  ...over,
});

const adjustment = (over: Partial<Adjustment> = {}): Adjustment => ({
  paymentId: "p1",
  kind: "refund",
  amountCents: DEPOSIT,
  ...over,
});

/** The deposit check, decided from net money the way the engine does it. */
function depositCheckPasses(netCents: number): boolean {
  const facts: JobFacts = {
    status: "approved",
    servicesDefined: true,
    servicesSource: "1 service",
    proposalAccepted: true,
    proposalSource: "The proposal",
    measurementRequired: false,
    measurementsPresent: true,
    scheduled: true,
    crewAssigned: true,
    workOrderReady: true,
    workOrderSource: "Date and services",
    materials: "not_required",
    materialsSource: "None",
    equipment: "not_required",
    equipmentSource: "None",
    access: "confirmed",
    accessSource: "Gate code",
    depositRequiredCents: DEPOSIT,
    depositReceivedCents: netCents,
    depositSource: "Net of refunds",
    evaluationPhotos: 1,
    preworkPhotos: 1,
    afterPhotos: 0,
    walkthroughDone: false,
    invoiceRaised: false,
    balanceOutstanding: null,
    financialDisposition: null,
  };
  const result = evaluateGate("ready", facts);
  return result.checks.find((c) => c.key === "deposit")!.passed;
}

describe("a receipt is not a permanent fact", () => {
  it("1. counts a deposit that was received, and the check passes", () => {
    const net = netAppliedToJob(JOB, [receipt()], []);
    expect(net).toBe(DEPOSIT);
    expect(depositSatisfied(DEPOSIT, net)).toBe(true);
    expect(depositCheckPasses(net)).toBe(true);
  });

  it("2. stops counting it once it is refunded, and the check fails again", () => {
    const net = netAppliedToJob(JOB, [receipt()], [adjustment({ kind: "refund" })]);
    expect(net).toBe(0);
    expect(depositSatisfied(DEPOSIT, net)).toBe(false);
    expect(depositCheckPasses(net)).toBe(false);
  });

  it("3. stops counting it on a chargeback or a reversal", () => {
    for (const kind of ["chargeback", "reversal", "void"] as const) {
      const net = netAppliedToJob(JOB, [receipt()], [adjustment({ kind })]);
      expect(net, kind).toBe(0);
      expect(depositCheckPasses(net), kind).toBe(false);
    }
  });

  it("4. keeps the check passing where a partial refund still leaves enough", () => {
    // £600 taken against a £500 deposit; £100 back leaves exactly enough.
    const net = netAppliedToJob(JOB, [receipt({ amountCents: 60_000 })], [adjustment({ amountCents: 10_000 })]);
    expect(net).toBe(50_000);
    expect(depositCheckPasses(net)).toBe(true);
  });

  it("5. fails the check where a partial refund drops it below the deposit", () => {
    const net = netAppliedToJob(JOB, [receipt({ amountCents: 60_000 })], [adjustment({ amountCents: 20_000 })]);
    expect(net).toBe(40_000);
    expect(depositCheckPasses(net)).toBe(false);
  });

  it("6. does not count money paid on another job", () => {
    const net = netAppliedToJob(JOB, [receipt({ id: "p9", jobId: OTHER, amountCents: 900_000 })], []);
    expect(net).toBe(0);
    expect(depositCheckPasses(net)).toBe(false);
  });

  it("7. goes on counting a historical receipt that has no adjustments", () => {
    // What the backfill leaves behind: an old row, no adjustment against it.
    const old = receipt({ id: "legacy", receivedAt: "2024-04-02T09:00:00.000Z" });
    expect(netAppliedToJob(JOB, [old], [])).toBe(DEPOSIT);
    expect(depositCheckPasses(netAppliedToJob(JOB, [old], []))).toBe(true);
  });
});

describe("the arithmetic itself", () => {
  it("counts nothing for money that was never actually taken", () => {
    expect(netOfReceipt(receipt({ receivedAt: null }), [])).toBe(0);
  });

  it("adds up several adjustments against one receipt", () => {
    const net = netOfReceipt(receipt({ amountCents: 60_000 }), [
      adjustment({ amountCents: 10_000 }),
      adjustment({ amountCents: 5_000, kind: "chargeback" }),
    ]);
    expect(net).toBe(45_000);
  });

  it("never goes below zero, because a job cannot owe the business money it never had", () => {
    expect(netOfReceipt(receipt(), [adjustment({ amountCents: 999_999 })])).toBe(0);
  });

  it("ignores an adjustment against a different receipt", () => {
    expect(netOfReceipt(receipt(), [adjustment({ paymentId: "somebody-else" })])).toBe(DEPOSIT);
  });

  it("adds up several receipts on the same job", () => {
    const net = netAppliedToJob(
      JOB,
      [receipt({ id: "a", amountCents: 20_000 }), receipt({ id: "b", amountCents: 30_000 })],
      []
    );
    expect(net).toBe(50_000);
  });
});

describe("what the check tells somebody", () => {
  it("says plainly when nothing has been paid", () => {
    expect(describeNet([], [], JOB)).toBe("No payment has been recorded against this job");
  });

  it("says nothing has gone back out when nothing has", () => {
    expect(describeNet([receipt()], [], JOB)).toContain("none refunded or reversed");
  });

  it("says what came in and what went back out", () => {
    const said = describeNet([receipt({ amountCents: 60_000 })], [adjustment({ amountCents: 10_000 })], JOB);
    expect(said).toContain("$600 taken");
    expect(said).toContain("$100 refunded");
    expect(said).toContain("$500 net");
  });
});

describe("what a kind is allowed to be", () => {
  it("refuses anything not in the list, so a form cannot invent one", () => {
    expect(isAdjustmentKind("chargeback")).toBe(true);
    expect(isAdjustmentKind("clawback")).toBe(false);
  });
});

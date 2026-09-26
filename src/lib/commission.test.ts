import { describe, expect, it } from "vitest";

import {
  DEFAULT_ACCOUNT_MANAGER_PCT,
  commissionFor,
  commissionState,
  type CommissionJobInput,
} from "@/lib/commission";

function job(overrides: Partial<CommissionJobInput> = {}): CommissionJobInput {
  return {
    jobId: "j1",
    customerName: "Pat Rivera",
    address: "208 Crafton Rd",
    status: "completed",
    completedAt: "2026-08-18T15:00:00Z",
    collected: 1000,
    contractValue: 1000,
    openTickets: 0,
    ...overrides,
  };
}

describe("commissionState", () => {
  it("pays out a finished job with nothing open on it", () => {
    expect(commissionState(job(), DEFAULT_ACCOUNT_MANAGER_PCT).state).toBe("earned");
  });

  it("holds a finished job that still has a ticket", () => {
    // Somebody has to go back, and the cost of that trip has not landed yet.
    const held = commissionState(job({ openTickets: 2 }), DEFAULT_ACCOUNT_MANAGER_PCT);
    expect(held.state).toBe("held");
    expect(held.reason).toBe("2 tickets still open on this job.");
  });

  it("holds a finished job nobody has paid for", () => {
    expect(commissionState(job({ collected: 0 }), DEFAULT_ACCOUNT_MANAGER_PCT).state).toBe("held");
  });

  it("accrues while the work is still running", () => {
    expect(commissionState(job({ status: "in_progress" }), DEFAULT_ACCOUNT_MANAGER_PCT).state).toBe("accruing");
  });
});

describe("commissionFor", () => {
  it("takes the percentage from what was collected, not what was quoted", () => {
    // Paying on an invoice that never clears is paying out on revenue the
    // business never saw.
    const [line] = commissionFor([job({ collected: 4000, contractValue: 10000 })], 15).lines;
    expect(line.amount).toBe(600);
    expect(line.outstanding).toBe(6000);
  });

  it("falls back to the house rate when the profile has none", () => {
    const summary = commissionFor([job({ collected: 1000 })], null);
    expect(summary.pct).toBe(DEFAULT_ACCOUNT_MANAGER_PCT);
    expect(summary.earned).toBe(150);
  });

  it("uses the rate on the profile when it has one", () => {
    expect(commissionFor([job({ collected: 1000 })], 20).earned).toBe(200);
  });

  it("keeps held money out of the payable total but still counts it", () => {
    const summary = commissionFor(
      [
        job({ jobId: "clean", collected: 1000 }),
        job({ jobId: "snagged", collected: 2000, openTickets: 1 }),
        job({ jobId: "running", status: "in_progress", collected: 500 }),
      ],
      15
    );
    expect(summary.earned).toBe(150);
    expect(summary.held).toBe(300);
    expect(summary.accruing).toBe(75);
  });

  it("drops cancelled jobs entirely", () => {
    expect(commissionFor([job({ status: "cancelled" })], 15).lines).toEqual([]);
  });

  it("keeps a finished job with nothing collected, so it can be chased", () => {
    const [line] = commissionFor([job({ collected: 0 })], 15).lines;
    expect(line.amount).toBe(0);
    expect(line.reason).toBe("Finished, but nothing has been collected yet.");
  });

  it("puts payable first, then held, then accruing", () => {
    const summary = commissionFor(
      [
        job({ jobId: "running", status: "in_progress" }),
        job({ jobId: "snagged", openTickets: 1 }),
        job({ jobId: "clean" }),
      ],
      15
    );
    expect(summary.lines.map((l) => l.jobId)).toEqual(["clean", "snagged", "running"]);
  });

  it("rounds to the cent rather than carrying fractions of one", () => {
    expect(commissionFor([job({ collected: 3333.33 })], 15).earned).toBe(500);
  });
});

describe("tracking what has actually been handed over", () => {
  const RATE = 15;

  it("calls a job paid once the whole of it has gone out", () => {
    // 15% of 1000 is 150, and 150 has been paid.
    const state = commissionState(job({ paidOut: 150, lastPaidAt: "2026-09-01T00:00:00Z" }), RATE);
    expect(state.state).toBe("paid");
    expect(state.reason).toContain("Paid on");
  });

  it("shows a paid job as owing nothing", () => {
    const [line] = commissionFor([job({ paidOut: 150 })], RATE).lines;
    expect(line.amount).toBe(0);
    expect(line.paidOut).toBe(150);
    expect(line.earnedTotal).toBe(150);
  });

  it("puts a paid job back to payable when more money comes in", () => {
    // Commission grows with what is collected. Another cheque on a settled
    // job is more commission, not a rounding error.
    const line = commissionFor([job({ collected: 2000, paidOut: 150 })], RATE).lines[0];
    expect(line.state).toBe("earned");
    expect(line.amount).toBe(150);
    expect(line.reason).toContain("still to come");
  });

  it("does not let a cent of rounding read as a debt", () => {
    expect(commissionState(job({ collected: 1000.03, paidOut: 150 }), RATE).state).toBe("paid");
  });

  it("keeps a part paid job that is still running out of payable", () => {
    // The work is not finished, so the rest is not owed yet whatever has
    // already been handed over.
    const line = commissionFor([job({ status: "in_progress", collected: 2000, paidOut: 150 })], RATE).lines[0];
    expect(line.state).toBe("accruing");
    expect(line.amount).toBe(150);
  });

  it("counts what has gone out separately from what is owed", () => {
    const summary = commissionFor(
      [
        job({ jobId: "a", collected: 1000, paidOut: 150 }),
        job({ jobId: "b", collected: 1000, paidOut: 0 }),
      ],
      RATE
    );
    expect(summary.paid).toBe(150);
    expect(summary.earned).toBe(150);
  });

  it("counts a part payment towards what has gone out", () => {
    const summary = commissionFor([job({ collected: 2000, paidOut: 150 })], RATE);
    expect(summary.paid).toBe(150);
    expect(summary.earned).toBe(150);
  });

  it("never counts the same money as both paid and owed", () => {
    const summary = commissionFor(
      [
        job({ jobId: "a", collected: 1000, paidOut: 150 }),
        job({ jobId: "b", collected: 800, paidOut: 60 }),
        job({ jobId: "c", collected: 500, paidOut: 0 }),
      ],
      RATE
    );
    const everEarned = (1000 + 800 + 500) * 0.15;
    expect(summary.paid + summary.earned + summary.held + summary.accruing).toBeCloseTo(everEarned, 2);
  });

  it("puts paid jobs last, because they are an answer and not a job to do", () => {
    const summary = commissionFor(
      [
        job({ jobId: "settled", paidOut: 150 }),
        job({ jobId: "owed" }),
        job({ jobId: "stuck", openTickets: 1 }),
      ],
      RATE
    );
    expect(summary.lines.map((l) => l.jobId)).toEqual(["owed", "stuck", "settled"]);
  });

  it("treats a job nobody has been paid for exactly as it did before", () => {
    const line = commissionFor([job()], RATE).lines[0];
    expect(line.state).toBe("earned");
    expect(line.paidOut).toBe(0);
    expect(line.amount).toBe(150);
  });
});

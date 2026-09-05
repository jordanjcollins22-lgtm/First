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
    expect(commissionState(job()).state).toBe("earned");
  });

  it("holds a finished job that still has a ticket", () => {
    // Somebody has to go back, and the cost of that trip has not landed yet.
    const held = commissionState(job({ openTickets: 2 }));
    expect(held.state).toBe("held");
    expect(held.reason).toBe("2 tickets still open on this job.");
  });

  it("holds a finished job nobody has paid for", () => {
    expect(commissionState(job({ collected: 0 })).state).toBe("held");
  });

  it("accrues while the work is still running", () => {
    expect(commissionState(job({ status: "in_progress" })).state).toBe("accruing");
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

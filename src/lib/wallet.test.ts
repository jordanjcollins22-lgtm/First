import { describe, expect, it } from "vitest";

import type { CommissionLine, CommissionSummary } from "@/lib/commission";
import { allocatePayout, groupPayouts, walletFor, whyNotRequest, type PayoutRequestRow } from "@/lib/wallet";

function line(over: Partial<CommissionLine>): CommissionLine {
  return {
    jobId: "j",
    customerName: "Pat Miller",
    address: "",
    state: "earned",
    reason: "",
    earnedTotal: 0,
    paidOut: 0,
    lastPaidAt: null,
    collected: 0,
    contractValue: null,
    outstanding: 0,
    pct: 4,
    amount: 0,
    completedAt: null,
    openTickets: 0,
    ...over,
  };
}

const summary = (lines: CommissionLine[]): CommissionSummary => ({
  pct: 4,
  lines,
  earned: lines.filter((l) => l.state === "earned").reduce((s, l) => s + l.amount, 0),
  held: lines.filter((l) => l.state === "held").reduce((s, l) => s + l.amount, 0),
  accruing: 0,
  paid: lines.reduce((s, l) => s + l.paidOut, 0),
});

const request = (over: Partial<PayoutRequestRow>): PayoutRequestRow => ({
  id: "r",
  profileId: "p",
  amount: 50,
  status: "requested",
  requestedAt: "2026-11-17T12:00:00Z",
  decidedAt: null,
  decisionNote: null,
  sentAt: null,
  method: null,
  reference: null,
  ...over,
});

describe("walletFor", () => {
  const book = summary([
    line({ jobId: "a", customerName: "Pat Miller", earnedTotal: 74, amount: 74, collected: 1850, completedAt: "2026-11-14T00:00:00Z" }),
    line({ jobId: "b", customerName: "Sam Lopez", state: "accruing", collected: 0, contractValue: 2500, outstanding: 2500 }),
  ]);

  it("shows what's ready, and the 4% of what clients still owe", () => {
    const w = walletFor(book, [], []);
    expect(w.ready).toBe(74);
    expect(w.waiting).toBe(100);
    expect(w.canRequest).toBe(74);
    expect(w.open).toBeNull();
  });

  it("an open request blocks a second one, and the money stays in the wallet until it's sent", () => {
    const w = walletFor(book, [request({ status: "approved" })], []);
    expect(w.ready).toBe(74);
    expect(w.canRequest).toBe(0);
    expect(whyNotRequest(w)).toMatch(/already asked/);
  });

  it("a declined or sent request doesn't block", () => {
    expect(walletFor(book, [request({ status: "declined" }), request({ status: "sent" })], []).open).toBeNull();
  });

  it("history lists earned and paid out, newest first", () => {
    const w = walletFor(book, [], [{ amount: 150, at: "2026-11-03T00:00:00Z" }]);
    expect(w.history).toEqual([
      { label: "Miller project", amount: 74, at: "2026-11-14T00:00:00Z" },
      { label: "Paid out to your bank", amount: -150, at: "2026-11-03T00:00:00Z" },
    ]);
  });

  it("nothing ready, nothing to ask for", () => {
    expect(whyNotRequest(walletFor(null, [], []))).toMatch(/Nothing is ready/);
  });
});

describe("allocatePayout", () => {
  it("takes the oldest money first, up to the amount sent", () => {
    const lines = [
      line({ jobId: "new", amount: 50, completedAt: "2026-11-10" }),
      line({ jobId: "old", amount: 30, completedAt: "2026-10-01" }),
      line({ jobId: "held", state: "held", amount: 99 }),
    ];
    expect(allocatePayout(lines, 60)).toEqual([
      { jobId: "old", amount: 30 },
      { jobId: "new", amount: 30 },
    ]);
  });
});

describe("groupPayouts", () => {
  it("one payout across several jobs is one entry", () => {
    const out = groupPayouts([
      { amount: 30, paid_at: "2026-11-03T10:00:00Z", reference: "Z1" },
      { amount: 20, paid_at: "2026-11-03T10:00:00Z", reference: "Z1" },
      { amount: 10, paid_at: "2026-10-01T10:00:00Z", reference: null },
    ]);
    expect(out).toEqual([
      { amount: 50, at: "2026-11-03T10:00:00Z" },
      { amount: 10, at: "2026-10-01T10:00:00Z" },
    ]);
  });
});

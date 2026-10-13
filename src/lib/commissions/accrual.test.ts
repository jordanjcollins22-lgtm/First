import { describe, expect, it } from "vitest";

import {
  accrualsForPayment,
  affiliateRateMismatches,
  buildStatements,
  grossMarginPct,
  lastCompletedWeek,
  payableNow,
  rateFor,
} from "./accrual";

const defaults = { account_manager: 7, evaluator: 4, affiliate: 4 };
const off = { on: false, collectPct: 50, marginPct: 40 };
const roles = { accountManagerId: "am", evaluatorId: "ev", affiliateId: "af" };

const base = {
  amount: 1000,
  roles,
  soldAt: "2026-10-01",
  splitFrom: "2026-09-29",
  owners: new Set<string>(),
  ratesOnFile: new Map<string, number>(),
  defaults,
  legacyPct: new Map<string, number | null>(),
  holdback: off,
};

describe("accrualsForPayment", () => {
  it("pays each share at the default rate", () => {
    const rows = accrualsForPayment(base);
    expect(rows.map((r) => [r.profileId, r.role, r.amount, r.payOnCollect])).toEqual([
      ["am", "account_manager", 70, false],
      ["ev", "evaluator", 40, false],
      ["af", "affiliate", 40, true],
    ]);
  });

  it("uses a person's own rate on file", () => {
    const rows = accrualsForPayment({ ...base, ratesOnFile: new Map([["af:affiliate", 5]]) });
    expect(rows.find((r) => r.role === "affiliate")?.amount).toBe(50);
    expect(rateFor("af", "affiliate", new Map(), defaults)).toBe(4);
  });

  it("gives the owner nothing", () => {
    const rows = accrualsForPayment({ ...base, owners: new Set(["ev"]) });
    expect(rows.some((r) => r.profileId === "ev")).toBe(false);
  });

  it("keeps the old deal for a job sold before the pool", () => {
    const rows = accrualsForPayment({ ...base, soldAt: "2026-09-01", legacyPct: new Map([["am", 15]]) });
    expect(rows).toEqual([
      { profileId: "am", role: "account_manager", pct: 15, baseAmount: 1000, amount: 150, portion: "collection", payOnCollect: false },
    ]);
  });

  it("splits hold-back for the account manager and evaluator, never the affiliate", () => {
    const rows = accrualsForPayment({ ...base, holdback: { on: true, collectPct: 60, marginPct: 40 } });
    const am = rows.filter((r) => r.profileId === "am");
    expect(am.map((r) => [r.portion, r.amount, r.payOnCollect])).toEqual([
      ["collection", 42, true],
      ["holdback", 28, false],
    ]);
    expect(rows.filter((r) => r.profileId === "af").map((r) => r.portion)).toEqual(["collection"]);
  });

  it("produces nothing for a zero payment", () => {
    expect(accrualsForPayment({ ...base, amount: 0 })).toEqual([]);
  });
});

describe("payableNow", () => {
  const job = { status: "completed", openTickets: 0, designIssues: 0, marginPct: 45 };
  it("pays an affiliate on collection", () => {
    expect(payableNow({ role: "affiliate", portion: "collection", payOnCollect: true }, { ...job, status: "in_progress" }, off).payable).toBe(true);
  });
  it("waits for sign-off for an account manager without hold-back", () => {
    expect(payableNow({ role: "account_manager", portion: "collection", payOnCollect: false }, { ...job, status: "in_progress" }, off).payable).toBe(false);
    expect(payableNow({ role: "account_manager", portion: "collection", payOnCollect: false }, { ...job, openTickets: 1 }, off).payable).toBe(false);
    expect(payableNow({ role: "account_manager", portion: "collection", payOnCollect: false }, job, off).payable).toBe(true);
  });
  it("releases hold-back only at margin", () => {
    const row = { role: "account_manager" as const, portion: "holdback" as const, payOnCollect: false };
    expect(payableNow(row, job, off).payable).toBe(true);
    expect(payableNow(row, { ...job, marginPct: 30 }, off).reason).toMatch(/30%/);
    expect(payableNow(row, { ...job, marginPct: null }, off).payable).toBe(false);
    expect(payableNow(row, { ...job, status: "in_progress" }, off).payable).toBe(false);
  });
  it("holds an evaluator's share on a site map issue", () => {
    expect(payableNow({ role: "evaluator", portion: "collection", payOnCollect: true }, { ...job, designIssues: 1 }, off).payable).toBe(false);
  });
});

describe("grossMarginPct", () => {
  it("works out margin from final costs", () => {
    expect(grossMarginPct({ priceCents: 100000, crewHours: 10, crewCostPerHourCents: 3500, materialsCents: 20000, otherCents: 5000 })).toBe(40);
    expect(grossMarginPct({ priceCents: 100000, crewHours: null, crewCostPerHourCents: 3500, materialsCents: 0, otherCents: 0 })).toBeNull();
  });
});

describe("lastCompletedWeek", () => {
  it("is last Monday to Sunday in New York", () => {
    // Tuesday 13 Oct 2026, mid-morning in New York.
    expect(lastCompletedWeek(new Date("2026-10-13T14:00:00Z"))).toEqual({ weekStart: "2026-10-05", weekEnd: "2026-10-11" });
    // Monday 12 Oct 2026 at 1am UTC is still Sunday evening in New York.
    expect(lastCompletedWeek(new Date("2026-10-12T01:00:00Z"))).toEqual({ weekStart: "2026-09-28", weekEnd: "2026-10-04" });
  });
});

describe("buildStatements", () => {
  it("groups by person and job and takes off hand payments", () => {
    const statements = buildStatements(
      [
        { id: "1", profileId: "am", jobId: "j1", amount: 40 },
        { id: "2", profileId: "am", jobId: "j1", amount: 30 },
        { id: "3", profileId: "am", jobId: "j2", amount: 10 },
        { id: "4", profileId: "af", jobId: "j1", amount: 40 },
      ],
      new Map([["j1:am", 50]])
    );
    expect(statements).toEqual([
      { profileId: "af", total: 40, lines: [{ jobId: "j1", amount: 40, offset: 0, accrualIds: ["4"] }] },
      {
        profileId: "am",
        total: 30,
        lines: [
          { jobId: "j1", amount: 20, offset: 50, accrualIds: ["1", "2"] },
          { jobId: "j2", amount: 10, offset: 0, accrualIds: ["3"] },
        ],
      },
    ]);
  });
});

describe("affiliateRateMismatches", () => {
  it("lists affiliates whose rate on file is not the default", () => {
    const people = [
      { id: "a", name: "A", isAffiliate: true, commissionPct: 15 },
      { id: "b", name: "B", isAffiliate: true, commissionPct: null },
      { id: "c", name: "C", isAffiliate: true, commissionPct: 5 },
      { id: "d", name: "D", isAffiliate: true, commissionPct: 15 },
      { id: "e", name: "E", isAffiliate: false, commissionPct: 15 },
    ];
    const found = affiliateRateMismatches(people, new Map([["c:affiliate", 6], ["d:affiliate", 4]]), 4);
    expect(found.map((m) => [m.profileId, m.onFile, m.from])).toEqual([
      ["a", 15, "commission_pct"],
      ["b", null, "none"],
      ["c", 6, "affiliate_rate"],
    ]);
  });
});

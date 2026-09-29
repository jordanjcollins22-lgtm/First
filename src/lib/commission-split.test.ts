import { describe, expect, it } from "vitest";

import { describeShare, keptPct, sharesFor, shareRule, usesSplit } from "./commission-split";

describe("the commission pool", () => {
  it("splits 7 / 4 / 4 across three people", () => {
    const shares = sharesFor({ accountManagerId: "jace", evaluatorId: "shalon", affiliateId: "max" });
    expect(shares).toEqual([
      { profileId: "jace", roles: ["account_manager"], pct: 7 },
      { profileId: "shalon", roles: ["evaluator"], pct: 4 },
      { profileId: "max", roles: ["affiliate"], pct: 4 },
    ]);
    expect(keptPct(shares)).toBe(0);
  });

  it("gives one person every share they filled", () => {
    const shares = sharesFor({ accountManagerId: "jace", evaluatorId: "jace", affiliateId: "jace" });
    expect(shares).toEqual([{ profileId: "jace", roles: ["account_manager", "evaluator", "affiliate"], pct: 15 }]);
  });

  it("keeps a share nobody earned, and the owner's", () => {
    const shares = sharesFor({ accountManagerId: "jace", evaluatorId: "jordan", affiliateId: null }, new Set(["jordan"]));
    expect(shares).toEqual([{ profileId: "jace", roles: ["account_manager"], pct: 7 }]);
    expect(keptPct(shares)).toBe(8);
  });

  it("splits projects sold from the day it started", () => {
    expect(usesSplit("2026-09-29T15:00:00Z", "2026-09-29")).toBe(true);
    expect(usesSplit("2026-09-28T23:00:00Z", "2026-09-29")).toBe(false);
    expect(usesSplit(null, "2026-09-29")).toBe(true);
  });

  it("pays the affiliate on payment, and holds the evaluator's on a site map issue", () => {
    expect(shareRule(["affiliate"], 0)).toEqual({ onCollect: true, hold: null });
    expect(shareRule(["account_manager", "affiliate"], 0).onCollect).toBe(false);
    expect(shareRule(["evaluator"], 1).hold).toMatch(/site map/);
    expect(shareRule(["account_manager"], 2).hold).toBeNull();
    expect(describeShare(["account_manager", "evaluator"])).toBe("Account manager 7% + Evaluator 4%");
  });
});

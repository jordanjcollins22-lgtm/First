import { describe, expect, it } from "vitest";

import { assessSubcontracting, canBidSetAside, checkSubcontractPlan, workCategoryForNaics } from "../compliance";

const SB = ["small_business" as const];

describe("limitations on subcontracting", () => {
  it("treats full & open as unrestricted", () => {
    const a = assessSubcontracting({ setAside: "none", naicsCode: "561730", estimatedValue: 2_000_000, ourCerts: SB });
    expect(a.status).toBe("unrestricted");
    expect(a.maxShareToNonSimilarlySituated).toBe(1);
  });

  it("exempts small business set-asides at or under the $350k SAT", () => {
    const a = assessSubcontracting({ setAside: "small_business", naicsCode: "561730", estimatedValue: 120_000, ourCerts: SB });
    expect(a.status).toBe("unrestricted");
  });

  it("lets the solicitation's 52.219-14 clause override the SAT exemption", () => {
    const a = assessSubcontracting({ setAside: "small_business", naicsCode: "561730", estimatedValue: 120_000, ourCerts: SB, losClausePresent: true });
    expect(a.status).toBe("similarly_situated_required");
    expect(a.requiredSubStatus).toBe("small_business");
  });

  it("requires small subs above the SAT or when value is unknown", () => {
    for (const estimatedValue of [900_000, null]) {
      const a = assessSubcontracting({ setAside: "small_business", naicsCode: "561720", estimatedValue, ourCerts: SB });
      expect(a.status).toBe("similarly_situated_required");
      expect(a.maxShareToNonSimilarlySituated).toBe(0.5);
    }
  });

  it("uses construction caps for construction NAICS", () => {
    expect(workCategoryForNaics("238220")).toBe("specialty_construction");
    expect(workCategoryForNaics("236220")).toBe("general_construction");
    const a = assessSubcontracting({ setAside: "small_business", naicsCode: "238220", estimatedValue: 500_000, ourCerts: SB });
    expect(a.maxShareToNonSimilarlySituated).toBe(0.75);
  });

  it("blocks program set-asides we don't hold, and requires matching subs when we do", () => {
    expect(assessSubcontracting({ setAside: "sdvosb", naicsCode: "561730", estimatedValue: 50_000, ourCerts: SB }).status).toBe("ineligible");
    const a = assessSubcontracting({ setAside: "wosb", naicsCode: "561730", estimatedValue: 50_000, ourCerts: ["small_business", "wosb"] });
    expect(a.status).toBe("similarly_situated_required"); // applies at any value
    expect(a.requiredSubStatus).toBe("wosb");
    expect(canBidSetAside("vosb", ["sdvosb"])).toBe(true);
    expect(canBidSetAside("other", SB)).toBe(false);
  });

  it("checks a planned subcontract against the cap", () => {
    const assessment = assessSubcontracting({ setAside: "small_business", naicsCode: "561730", estimatedValue: 1_000_000, ourCerts: SB });
    expect(checkSubcontractPlan({ assessment, awardAmount: 1_000_000, subAmount: 800_000, subIsSimilarlySituated: true }).compliant).toBe(true);
    expect(checkSubcontractPlan({ assessment, awardAmount: 1_000_000, subAmount: 800_000, subIsSimilarlySituated: false }).compliant).toBe(false);
    expect(checkSubcontractPlan({ assessment, awardAmount: 1_000_000, subAmount: 450_000, subIsSimilarlySituated: false }).compliant).toBe(true);
  });
});

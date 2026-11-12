import { describe, expect, it } from "vitest";
import { adCopy, estimateReturn, launchOperations, performanceFrom, suggestBudgetCents, zipFromAddress } from "./ad-draft";

const row = (spend: number, leads: number, sold: number, collected: number) => ({
  campaign: "x",
  spend,
  clicks: 0,
  leads,
  sold,
  collected,
  costPerLead: null,
  returnPerDollar: null,
});

describe("performance and budget", () => {
  it("starts at the smallest budget with no history", () => {
    const p = performanceFrom([]);
    expect(p.fromHistory).toBe(false);
    expect(suggestBudgetCents(p)).toBe(1000);
  });

  it("suggests more where the ads have paid back", () => {
    expect(suggestBudgetCents(performanceFrom([row(1000, 10, 4, 1500)]))).toBe(2000);
    expect(suggestBudgetCents(performanceFrom([row(1000, 10, 4, 3000)]))).toBe(3000);
    expect(suggestBudgetCents(performanceFrom([row(1000, 10, 4, 5000)]))).toBe(5000);
    expect(suggestBudgetCents(performanceFrom([row(1000, 10, 1, 500)]))).toBe(1000);
  });

  it("estimates 30 days at the ads' own rates", () => {
    const p = performanceFrom([row(800, 4, 2, 4250)]);
    expect(estimateReturn(3000, p)).toEqual({ spend: 900, leads: 4.5, jobs: 2.3, revenue: 4781, returnPerDollar: 5.31 });
  });
});

describe("adCopy", () => {
  it("fits Google's limits and has enough lines", () => {
    const copy = adCopy({ services: ["Spring Cleanup and Mulching Service"], town: "Bel Air", business: "JS Landscaping" });
    expect(copy.headlines.length).toBeGreaterThanOrEqual(3);
    expect(copy.headlines.every((h) => h.length <= 30)).toBe(true);
    expect(copy.descriptions).toHaveLength(2);
    expect(copy.descriptions.every((d) => d.length <= 90)).toBe(true);
    expect(new Set(copy.headlines).size).toBe(copy.headlines.length);
  });
});

describe("zipFromAddress", () => {
  it("takes the last five-digit number", () => {
    expect(zipFromAddress("1201 Main St, Bel Air, MD 21014")).toBe("21014");
    expect(zipFromAddress("12345 Long Rd, Fallston, MD 21047-1234")).toBe("21047");
    expect(zipFromAddress("Somewhere")).toBeNull();
  });
});

describe("launchOperations", () => {
  const ops = launchOperations({
    customerId: "1234567890",
    name: "Bel Air spring cleanup",
    dailyBudgetCents: 2000,
    copy: { headlines: ["a", "b", "c"], descriptions: ["d", "e"] },
    keywords: ["spring cleanup", "mulching"],
    finalUrl: "https://example.com/book",
    imageBase64: "AAAA",
    zip: "21014",
    radiusMiles: 10,
  });

  it("launches live with the budget in micros and the tracked link on the campaign", () => {
    const campaign = ops.find((o) => "campaignOperation" in o) as { campaignOperation: { create: Record<string, unknown> } };
    expect(campaign.campaignOperation.create.status).toBe("ENABLED");
    expect(campaign.campaignOperation.create.finalUrlSuffix).toBe("utm_source=google&utm_medium=cpc&utm_campaign=Bel+Air+spring+cleanup");
    const budget = ops.find((o) => "campaignBudgetOperation" in o) as { campaignBudgetOperation: { create: { amountMicros: string } } };
    expect(budget.campaignBudgetOperation.create.amountMicros).toBe("20000000");
  });

  it("aims at the job's ZIP and attaches the photo", () => {
    expect(ops.some((o) => "campaignCriterionOperation" in o)).toBe(true);
    expect(ops.at(-1)).toEqual({ campaignAssetOperation: { create: { campaign: "customers/1234567890/campaigns/-3", asset: "customers/1234567890/assets/-1", fieldType: "AD_IMAGE" } } });
    expect(ops.filter((o) => "adGroupCriterionOperation" in o)).toHaveLength(2);
  });
});

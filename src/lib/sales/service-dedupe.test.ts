import { describe, expect, it } from "vitest";

import { findDuplicates, hasRate, mergeBlocker, missingRates, nameKey, readRate, type ServiceRow } from "@/lib/sales/service-dedupe";
import { buildGoodBetterBest } from "@/lib/sales/good-better-best";
import { PRICING_EQUATION, PRODUCTION_SERVICES } from "@/lib/forward-pricing";
import { readOptions } from "@/lib/proposal-options";

const row = (over: Partial<ServiceRow>): ServiceRow => ({ serviceTypeId: "x", name: "X", status: "active", cost: null, costUnit: "flat rate", ...over });

describe("rate coverage", () => {
  it("lists active services with no rate, most used first", () => {
    const list = missingRates([
      row({ serviceTypeId: "a", name: "Bed", uses: 1 }),
      row({ serviceTypeId: "b", name: "Mow", cost: 45 }),
      row({ serviceTypeId: "c", name: "Trim", uses: 9 }),
      row({ serviceTypeId: "d", name: "Old", status: "denied" }),
      row({ serviceTypeId: "e", name: "Zero", cost: 0 }),
    ]);
    expect(list.map((r) => r.serviceTypeId)).toEqual(["c", "a", "e"]);
    expect(hasRate({ cost: 0 })).toBe(false);
  });

  it("reads a typed rate", () => {
    expect(readRate("$1,250.5")).toBe(1250.5);
    expect(readRate("")).toBeNull();
    expect(readRate("abc")).toBeNaN();
    expect(readRate("-4")).toBeNaN();
  });
});

describe("duplicate services", () => {
  it("matches names that say the same thing", () => {
    expect(nameKey("Plant / Bush Removal")).toBe(nameKey("bush & plant removal"));
    expect(nameKey("Plants and Bushes Removal")).toBe(nameKey("Plant / Bush Removal"));
    expect(nameKey("Grass")).toBe("grass");
    expect(nameKey("Mowing")).not.toBe(nameKey("Mulching"));
  });

  it("keeps the active, rated, used, built-in one", () => {
    const groups = findDuplicates([
      row({ serviceTypeId: "custom-1", name: "landscape bed", cost: null, uses: 0 }),
      row({ serviceTypeId: "landscape-bed", name: "Landscape Bed", cost: 300, uses: 4 }),
      row({ serviceTypeId: "custom-2", name: "Landscape  beds", status: "pending" }),
      row({ serviceTypeId: "mow", name: "Mowing" }),
      row({ serviceTypeId: "custom-3", name: "Mowing", status: "merged" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].keep.serviceTypeId).toBe("landscape-bed");
    expect(groups[0].merge.map((r) => r.serviceTypeId)).toEqual(["custom-1", "custom-2"]);
    expect(groups[0].why).toMatch(/has a rate/);
  });

  it("refuses a merge that makes no sense", () => {
    const a = row({ serviceTypeId: "a" });
    expect(mergeBlocker(a, a)).toMatch(/same service/);
    expect(mergeBlocker(a, row({ serviceTypeId: "b", status: "pending" }))).toMatch(/isn't active/);
    expect(mergeBlocker(row({ serviceTypeId: "a", status: "merged" }), row({ serviceTypeId: "b" }))).toMatch(/already merged/);
    expect(mergeBlocker(undefined, a)).toMatch(/no longer exists/);
    expect(mergeBlocker(a, row({ serviceTypeId: "b" }))).toBeNull();
  });
});

describe("Good / Better / Best", () => {
  const input = {
    areas: [
      [
        { key: "weed-pulling", quantity: 600, materialCents: 0 },
        { key: "mulch-install", quantity: 3, materialCents: 10_500 },
      ],
      [{ key: "shrub-trimming", quantity: 8, materialCents: 0 }],
    ],
    equation: PRICING_EQUATION,
    services: PRODUCTION_SERVICES,
    driveMinutesPerDay: 30,
  };

  it("offers three priced options, Better recommended, readable by the client page", () => {
    const options = buildGoodBetterBest(input)!;
    expect(options.options.map((o) => o.key)).toEqual(["good", "better", "best"]);
    const [good, better, best] = options.options;
    expect(good.totalCents).toBeLessThan(better.totalCents);
    expect(best.totalCents).toBeGreaterThan(better.totalCents);
    expect(better.recommended).toBe(true);
    expect(good.notIncluded).toContain("Mulch install");
    expect(best.includes).toContain("Weed spraying");
    // Each option's areas add up to its total, and the shape is what the page reads.
    for (const o of options.options) expect(o.areas.reduce((s, a) => s + a.priceCents, 0)).toBe(o.totalCents);
    expect(readOptions(options, 2)?.options).toHaveLength(3);
  });

  it("drops Good when it would barely save anything", () => {
    const options = buildGoodBetterBest({ ...input, areas: [[{ key: "weed-pulling", quantity: 600, materialCents: 0 }]] })!;
    expect(options.options.map((o) => o.key)).toEqual(["better", "best"]);
  });

  it("is nothing on an empty job", () => {
    expect(buildGoodBetterBest({ ...input, areas: [] })).toBeNull();
  });
});

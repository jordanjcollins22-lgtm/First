import { describe, expect, it } from "vitest";

import {
  PRICING_EQUATION,
  allocations,
  crewRateCents,
  priceForward,
  priceLine,
  projectCostMargin,
  readLines,
  revenueAllocation,
  suggestJob,
  suggestLines,
  type AreaFacts,
} from "@/lib/forward-pricing";

const eq = PRICING_EQUATION;

describe("the forward pricing equation", () => {
  it("works the training example through", () => {
    expect(crewRateCents(eq)).toBe(7500);
    expect(revenueAllocation(eq)).toBeCloseTo(0.65);
    expect(projectCostMargin(eq)).toBeCloseTo(0.35);
    expect(projectCostMargin({ ...eq, reserve: 0.05 })).toBeCloseTo(0.3);
    // 12 crew-hours at $75 is $900; with $500 of materials, R is $4,000.
    const labour = priceLine({ key: "weed-pulling", quantity: 12 * 600, materialCents: 0 }, eq);
    expect(labour.plh).toBeCloseTo(12);
    expect(labour.plcCents).toBeCloseTo(90_000);
    const job = priceForward([[labour, { key: "disposal", quantity: 1, materialCents: 50_000 }]], eq);
    expect(job.rCents).toBe(400_000);
    expect(job.allocations).toEqual({ grossProfitCents: 200_000, affiliateCents: 16_000, evaluatorCents: 16_000, accountManagerCents: 28_000, reserveCents: 0 });
  });

  it("prices each service at its own production rate", () => {
    expect(priceLine({ key: "weed-pulling", quantity: 600, materialCents: 0 }, eq).plh).toBe(1);
    expect(priceLine({ key: "weed-spraying", quantity: 600, materialCents: 0 }, eq).plh).toBeCloseTo(0.2);
    expect(priceLine({ key: "bush-removal-large", quantity: 1, materialCents: 0 }, eq).plh).toBe(1);
    // A cost with no crew time is its cost over PCM.
    expect(priceLine({ key: "disposal", quantity: 1, materialCents: 7500 }, eq).rCents).toBe(21_429);
  });

  it("matches the hand-worked price for the Bel Air weeding job", () => {
    const job = priceForward(
      [
        [
          { key: "weed-pulling", quantity: 1377, materialCents: 0 },
          { key: "weed-spraying", quantity: 1345, materialCents: 2500 },
          { key: "perennial-cutback", quantity: 1020, materialCents: 0 },
        ],
        [{ key: "plant-removal-small", quantity: 1, materialCents: 0 }],
        [{ key: "plant-cutback", quantity: 2, materialCents: 0 }],
        [{ key: "disposal", quantity: 1, materialCents: 7500 }],
      ],
      eq
    );
    expect(job.plh).toBeCloseTo(5.12, 2);
    expect(Math.round(job.plcCents)).toBe(38_375);
    expect(job.materialCents).toBe(10_000);
    expect(job.rCents).toBe(138_214);
    expect(allocations(job.rCents, eq).grossProfitCents).toBe(69_107);
  });

  it("adds an area's lines up to exactly its price", () => {
    const job = priceForward([[{ key: "weed-pulling", quantity: 333, materialCents: 0 }, { key: "weed-spraying", quantity: 333, materialCents: 777 }]], eq);
    expect(job.areas[0].rCents).toBe(job.areas[0].lines.reduce((s, l) => s + l.rCents, 0));
  });
});

const area = (over: Partial<AreaFacts>): AreaFacts => ({ typeId: "x", serviceName: "", values: {}, notes: null, areaSqFt: null, ...over });

describe("the services suggested from the walkthrough", () => {
  it("pulls anywhere that is sprayed, and cuts back where the notes say so", () => {
    const lines = suggestLines(area({ typeId: "custom-1", serviceName: "Weed Removal", notes: "Weed spraying, cutting back perennials for the winter", areaSqFt: 1020 }));
    expect(lines.map((l) => l.key)).toEqual(["weed-pulling", "weed-spraying", "perennial-cutback"]);
    expect(lines.every((l) => l.quantity === 1020)).toBe(true);
    expect(lines[1].materialCents).toBe(2040);
  });

  it("only pulls when nothing says spray", () => {
    expect(suggestLines(area({ serviceName: "Weed Removal", notes: "Client wants complete weed removal", areaSqFt: 90 })).map((l) => l.key)).toEqual(["weed-pulling"]);
  });

  it("removes plants by size and count", () => {
    expect(suggestLines(area({ typeId: "plant-bush-removal", values: { size: "Large", type: "Bush", quantity: "1" } }))[0]).toMatchObject({ key: "bush-removal-large", quantity: 1 });
    expect(suggestLines(area({ typeId: "plant-bush-removal", values: { size: "Small", type: "Plant", quantity: "3" } }))[0]).toMatchObject({ key: "plant-removal-small", quantity: 3 });
  });

  it("works mulch out in yards at two inches", () => {
    const lines = suggestLines(area({ typeId: "landscape-bed", values: { material: "Mulch", weedLevel: "Moderate", plantRelocation__qty: "8" }, areaSqFt: 800 }));
    expect(lines.map((l) => [l.key, l.quantity])).toEqual([
      ["weed-pulling", 800],
      ["plant-relocation", 8],
      ["mulch-install", 5],
    ]);
    expect(lines[2].materialCents).toBe(17_500);
  });

  it("leaves a missing count at nothing and says so", () => {
    const [line] = suggestLines(area({ typeId: "plant-installation", values: { plant: "mums", sizeContainer: "1 gallon" } }));
    expect(line).toMatchObject({ key: "plant-install-1gal", quantity: 0, materialCents: 0 });
    expect(line.note).toMatch(/No count/);
  });

  it("suggests nothing for a service with no production rate", () => {
    expect(suggestLines(area({ typeId: "soft-washing", serviceName: "Soft Washing", areaSqFt: 400 }))).toEqual([]);
  });

  it("puts one disposal line on the area with the most to haul away", () => {
    const job = suggestJob([
      area({ typeId: "trimming", values: { quantity: "2" }, notes: "Cut back for winter" }),
      area({ serviceName: "Weed Removal", notes: "spray", areaSqFt: 1000 }),
    ]);
    expect(job[0].some((l) => l.key === "disposal")).toBe(false);
    expect(job[1].filter((l) => l.key === "disposal")).toHaveLength(1);
  });
});

describe("lines sent back from the page", () => {
  it("keeps only real services, with nothing negative", () => {
    const read = readLines(
      [[{ key: "weed-pulling", quantity: -5, materialCents: 10 }, { key: "made-up", quantity: 1, materialCents: 1 }], []],
      2
    );
    expect(read).toEqual([[{ key: "weed-pulling", quantity: 0, materialCents: 10, note: null }], []]);
  });

  it("refuses lines that don't line up with the areas", () => {
    expect(readLines([[]], 2)).toBeNull();
    expect(readLines("nope", 1)).toBeNull();
  });
});

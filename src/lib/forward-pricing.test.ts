import { describe, expect, it } from "vitest";

import {
  PRICING_EQUATION,
  PRODUCTION_SERVICES,
  allocations,
  crewRateCents,
  offWork,
  priceForward,
  priceLine,
  pricePerUnitCents,
  projectCostMargin,
  readLines,
  readSetup,
  revenueAllocation,
  suggestJob,
  suggestLines,
  serviceKey,
  servicesByGroup,
  withNewServices,
  type AreaFacts,
} from "@/lib/forward-pricing";

const eq = PRICING_EQUATION;
/** The equation as trained, before travel and time off the work: every paid hour at the job. */
const work = { ...eq, onJobShare: 1 };

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
    const job = priceForward([[labour, { key: "disposal", quantity: 1, materialCents: 50_000 }]], work);
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
      work
    );
    expect(job.plh).toBeCloseTo(5.12, 2);
    expect(Math.round(job.plcCents)).toBe(38_375);
    expect(job.materialCents).toBe(10_000);
    expect(job.rCents).toBe(138_214);
    expect(allocations(job.rCents, eq).grossProfitCents).toBe(69_107);
  });

  it("adds an area's lines and its share of time off the work up to exactly its price", () => {
    const job = priceForward([[{ key: "weed-pulling", quantity: 333, materialCents: 0 }, { key: "weed-spraying", quantity: 333, materialCents: 777 }]], eq);
    expect(job.areas[0].rCents).toBe(job.areas[0].lines.reduce((s, l) => s + l.rCents, 0) + job.areas[0].offWork.rCents);
    expect(job.areas[0].offWork.rCents).toBeGreaterThan(0);
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

  it("suggests nothing for a kind of area it has no services for", () => {
    expect(suggestLines(area({ typeId: "custom-9", serviceName: "Fence repair", areaSqFt: 400 }))).toEqual([]);
  });

  it("prices every kind of area on the walkthrough", () => {
    const keys = (a: Partial<AreaFacts>) => suggestLines(area({ areaSqFt: 810, ...a })).map((l) => l.key);
    // Sod, after grading, topsoil an inch deep and soil prep.
    expect(keys({ typeId: "lawn-restoration", values: { method: "Sod", grade: "Needs Correction", soilCondition: "Needs Topsoil" } })).toEqual([
      "hand-grading",
      "topsoil-install",
      "soil-prep",
      "sod-install",
    ]);
    expect(keys({ typeId: "lawn-restoration", values: { condition: "Bare", method: "Seed" } })).toEqual(["soil-prep", "seeding"]);
    expect(keys({ typeId: "lawn-restoration", values: { condition: "Thin" } })).toEqual(["soil-prep", "overseeding"]);
    expect(keys({ typeId: "leaf-seasonal-cleanup", values: { type: "Full Fall Cleanup", leafVolume: "Heavy" } })).toEqual(["leaf-removal-heavy", "perennial-cutback"]);
    expect(keys({ typeId: "leaf-seasonal-cleanup", values: { type: "Fall Cutback" } })).toEqual(["perennial-cutback"]);
    expect(keys({ typeId: "leaf-seasonal-cleanup", values: { type: "Leaf Cleanup", leafVolume: "Light" } })).toEqual(["leaf-removal"]);
    expect(keys({ typeId: "grading" })).toEqual(["hand-grading"]);
    expect(keys({ typeId: "soft-washing" })).toEqual(["soft-washing"]);
    expect(keys({ typeId: "lawn-care", values: { serviceType: "Aeration" } })).toEqual(["aeration"]);
    expect(keys({ typeId: "lawn-care", values: { serviceType: "Fertilization" } })).toEqual(["fertilization"]);
    // Kinds the business added itself, by name.
    expect(keys({ typeId: "custom-6fe1", serviceName: "Snow Removal" })).toEqual(["snow-removal"]);
    expect(keys({ typeId: "custom-57a9", serviceName: "Sod Installation" })).toEqual(["soil-prep", "sod-install"]);
    expect(keys({ typeId: "custom-35da", serviceName: "Gutters" })).toEqual(["gutter-cleaning"]);
    expect(keys({ typeId: "landscape-bed", values: { material: "Rock", existingMaterialCondition: "Needs Removal", edge: "No Edge" } })).toEqual([
      "material-removal",
      "rock-install",
      "bed-edging",
    ]);
  });

  it("works out topsoil from the area and depth, and asks for edge length", () => {
    const lines = suggestLines(area({ typeId: "lawn-restoration", values: { soilCondition: "Needs Topsoil", method: "Sod" }, areaSqFt: 810 }));
    // 810 sq ft an inch deep is 2.5 cu yd.
    expect(lines.find((l) => l.key === "topsoil-install")).toMatchObject({ quantity: 2.5, materialCents: 10000 });
    expect(lines.find((l) => l.key === "sod-install")).toMatchObject({ quantity: 810, materialCents: 40500 });
    const [edge] = suggestLines(area({ typeId: "landscape-bed", values: { edge: "Existing Edge Needs Redone" } }));
    expect(edge).toMatchObject({ key: "bed-edging", quantity: 0 });
    expect(edge.note).toMatch(/linear feet/);
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

describe("the production rates settings", () => {
  const good = {
    equation: { leads: 1, technicians: 2, leadRateCents: 4500, technicianRateCents: 3000 },
    services: [
      { key: "weed-pulling", label: "Hand weed pulling", unit: "SF", pr: 600 },
      { key: "disposal", label: "Disposal", unit: "job", pr: 5, materialCentsPerUnit: 7500, materialName: "Dump fee" },
      { key: "old", label: "Old service", unit: "plant", pr: 4, active: false },
    ],
  };

  it("reads a good form, with the crew rate following the crew", () => {
    const read = readSetup(good);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(crewRateCents(read.setup.equation)).toBe(10_500);
    // A per-job cost has no crew time, whatever was typed.
    expect(read.setup.services[1].pr).toBeNull();
    expect(read.setup.services[2].active).toBe(false);
    // The shares are not set here.
    expect(read.setup.equation.grossProfit).toBe(0.5);
  });

  it("refuses a crew of nobody, a service with no name or rate, and negative costs", () => {
    expect(readSetup({ ...good, equation: { ...good.equation, leads: 0, technicians: 0 } }).ok).toBe(false);
    expect(readSetup({ ...good, services: [{ key: "x", label: "", unit: "SF", pr: 5 }] }).ok).toBe(false);
    expect(readSetup({ ...good, services: [{ key: "x", label: "X", unit: "SF", pr: 0 }] }).ok).toBe(false);
    expect(readSetup({ ...good, services: [{ key: "x", label: "X", unit: "SF", pr: 5, materialCentsPerUnit: -1 }] }).ok).toBe(false);
    expect(readSetup({ ...good, services: [{ key: "x", label: "X", unit: "acre", pr: 5 }] }).ok).toBe(false);
    expect(readSetup({ ...good, services: [good.services[0], good.services[0]] }).ok).toBe(false);
  });

  it("says what one unit is priced at", () => {
    // $75 a crew-hour over 600 sq ft is 12.5 cents a foot; over 0.35 that is about 36 cents.
    expect(Math.round(pricePerUnitCents({ key: "a", label: "A", unit: "SF", pr: 600 }, eq)!)).toBe(36);
    expect(Math.round(pricePerUnitCents({ key: "d", label: "D", unit: "job", pr: null, materialCentsPerUnit: 7000 }, eq)!)).toBe(20_000);
  });

  it("prices with the saved rates, and stops suggesting a service that is off", () => {
    const services = [{ key: "weed-pulling", label: "Hand weed pulling", unit: "SF" as const, pr: 300 }, { key: "weed-spraying", label: "Weed spraying", unit: "SF" as const, pr: 3000, active: false }];
    expect(priceLine({ key: "weed-pulling", quantity: 300, materialCents: 0 }, eq, services).plh).toBe(1);
    const lines = suggestLines(area({ serviceName: "Weed Removal", notes: "pull and spray", areaSqFt: 100 }), services);
    expect(lines.map((l) => l.key)).toEqual(["weed-pulling"]);
  });

  it("adds services new to the list to saved settings, keeping the saved rates", () => {
    const saved = [{ key: "weed-pulling", label: "Hand weed pulling", unit: "SF" as const, pr: 300 }];
    const merged = withNewServices(saved);
    expect(merged[0]).toMatchObject({ key: "weed-pulling", pr: 300, group: "Weeds and cleanup" });
    expect(merged.some((s) => s.key === "sod-install")).toBe(true);
    expect(merged.filter((s) => s.key === "weed-pulling")).toHaveLength(1);
  });

  it("sorts the add list into sections, leaving out services that are off", () => {
    const groups = servicesByGroup([
      { key: "a", label: "A", unit: "SF", pr: 1, group: "Lawn" },
      { key: "b", label: "B", unit: "SF", pr: 1, group: "Lawn", active: false },
      { key: "c", label: "C", unit: "SF", pr: 1 },
    ]);
    expect(groups).toEqual([
      { group: "Lawn", services: [expect.objectContaining({ key: "a" })] },
      { group: "Other", services: [expect.objectContaining({ key: "c" })] },
    ]);
    expect(servicesByGroup(PRODUCTION_SERVICES).map((g) => g.group)).toEqual(["Weeds and cleanup", "Plants and shrubs", "Beds and materials", "Lawn", "Seasonal", "Washing and gutters", "Other"]);
  });

  it("keeps how much each item holds and the bulk threshold when the settings are saved", () => {
    const id = "50aa615c-ff30-4225-ba82-037fe63d5abb";
    const read = readSetup({
      equation: { leads: 1, technicians: 1, leadRateCents: 4500, technicianRateCents: 3000 },
      services: [
        { key: "topsoil-install", label: "Topsoil", unit: "CY", pr: 2, materialHolds: { [id]: 0.0278, junk: 3, [`${id.slice(0, -1)}0`]: -1 }, bulkOver: 1.5, bulkMaterialId: id },
        { key: "mulch-install", label: "Mulch", unit: "CY", pr: 2.5, bulkOver: null },
      ],
    });
    expect(read.ok && read.setup.services[0]).toMatchObject({ materialHolds: { [id]: 0.0278 }, bulkOver: 1.5, bulkMaterialId: id });
    expect(read.ok && read.setup.services[1].bulkOver).toBeNull();
    // Saved before bulk existed: the starting threshold fills in; one turned off stays off.
    expect(withNewServices([{ key: "mulch-install", label: "Mulch", unit: "CY", pr: 2.5 }])[0].bulkOver).toBe(1);
    expect(withNewServices([{ key: "mulch-install", label: "Mulch", unit: "CY", pr: 2.5, bulkOver: null }])[0].bulkOver).toBeNull();
  });

  it("keeps a service's section when the settings are saved", () => {
    const read = readSetup({ equation: { leads: 1, technicians: 1, leadRateCents: 4500, technicianRateCents: 3000 }, services: [{ key: "sod-install", label: "Sod", unit: "SF", pr: 400, group: "Lawn" }, { key: "x", label: "X", unit: "LF", pr: 100, group: "Nonsense" }] });
    expect(read.ok && read.setup.services).toEqual([expect.objectContaining({ group: "Lawn" }), expect.not.objectContaining({ group: expect.anything() })]);
  });

  it("makes a key from a new service's name, never one already taken", () => {
    expect(serviceKey("Sod install!", [])).toBe("sod-install");
    expect(serviceKey("Sod install", ["sod-install"], () => 0.5)).toBe("sod-install-7fff");
  });
});

describe("travel and time off the work", () => {
  it("pays the rest of each day: a quarter as much again as the work, at 75%", () => {
    // 30 hours of work at 6 hours a day is 5 days; the time off them is 10 hours.
    const off = offWork(30, eq, 40);
    expect(off).toMatchObject({ days: 5, workHoursPerDay: 6, by: "share" });
    expect(off.plh).toBeCloseTo(10);
    expect(off.plcCents).toBeCloseTo(10 * 7500);
  });

  it("pays the drive when that is more, on a small job", () => {
    // 2 hours of work: the share is 0.67 hours, the 50 minute drive is 0.83.
    const off = offWork(2, eq, 50);
    expect(off).toMatchObject({ days: 1, by: "drive" });
    expect(off.plh).toBeCloseTo(50 / 60);
  });

  it("goes by the share when the drive is unknown, and is nothing with no work", () => {
    expect(offWork(6, eq, null)).toMatchObject({ days: 1, by: "share" });
    expect(offWork(0, eq, 40)).toMatchObject({ days: 0, plh: 0, by: "none" });
  });

  it("shares it across the areas by their crew-hours, so they still add up to the job", () => {
    const job = priceForward(
      [[{ key: "weed-pulling", quantity: 600 * 18, materialCents: 0 }], [{ key: "weed-pulling", quantity: 600 * 6, materialCents: 0 }]],
      eq,
      undefined,
      30
    );
    // 24 hours of work, 4 days, 8 hours off it: 6 and 2.
    expect(job.offWork.plh).toBeCloseTo(8);
    expect(job.areas[0].offWork.plh).toBeCloseTo(6);
    expect(job.areas[1].offWork.plh).toBeCloseTo(2);
    expect(job.plh).toBeCloseTo(32);
    expect(job.areas[0].rCents + job.areas[1].rCents).toBe(job.rCents);
    // 32 crew-hours at $75 over 0.35.
    expect(job.rCents).toBe(Math.round((18 * 7500) / 0.35) + Math.round((6 * 7500) / 0.35) + Math.round((6 * 7500) / 0.35) + Math.round((2 * 7500) / 0.35));
  });
});

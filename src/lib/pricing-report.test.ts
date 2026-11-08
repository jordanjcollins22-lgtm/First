import { describe, expect, it } from "vitest";

import { PRODUCTION_RATES_SEED } from "@/lib/production-rates-seed";
import { MATERIALS, rollUpMaterials, priceFor } from "@/lib/pricing-materials";
import {
  conditionFactor,
  crewMembers,
  daysFor,
  deriveQuantity,
  elapsedMinutes,
  labourMinutes,
  p4pSplit,
  priceProject,
  resolvePool,
  type ProjectInput,
} from "@/lib/pricing-report";
import { cleanSuggestion } from "@/lib/pricing-photo-suggestion";
import { SAMPLE_PROJECT } from "@/lib/pricing-report-sample";
import {
  CONDITIONS,
  DEFAULT_VARIABLES,
  bandLabel,
  capacityMultiplier,
  impliedMargin,
  readBands,
  readVariables,
  rateByKey,
} from "@/lib/pricing-variables";

const rate = (key: string) => rateByKey(DEFAULT_VARIABLES).get(key)!;

describe("the production rate seed", () => {
  it("has all 97 rows of the workbook, each key once", () => {
    expect(PRODUCTION_RATES_SEED).toHaveLength(97);
    expect(new Set(PRODUCTION_RATES_SEED.map((r) => r.key)).size).toBe(97);
  });

  it("keeps the workbook's figures", () => {
    expect(rate("bed-preparation.light-weed-removal").unitsPerLaborMinute).toBe(3);
    expect(rate("bed-installation.mulch-installation").unitsPerLaborMinute).toBe(0.0167);
    expect(rate("cleanup-and-debris.final-property-cleanup").unitsPerLaborMinute).toBe(100);
  });

  it("names only tasks that exist, in every condition and material", () => {
    const keys = new Set(PRODUCTION_RATES_SEED.map((r) => r.key));
    for (const c of CONDITIONS) for (const t of [...(c.scope.tasks ?? []), ...(c.scope.exceptTasks ?? [])]) expect(keys.has(t), t).toBe(true);
    for (const m of MATERIALS) for (const u of m.uses) expect(keys.has(u.task), u.task).toBe(true);
  });
});

describe("labour minutes", () => {
  it("is quantity ÷ units per labour-minute", () => {
    expect(labourMinutes(300, 3)).toBe(100);
    expect(labourMinutes(0, 3)).toBe(0);
    expect(labourMinutes(10, 0)).toBe(0);
  });

  it("multiplies by the condition factor", () => {
    expect(labourMinutes(300, 3, 1.5)).toBe(150);
  });
});

describe("condition multipliers", () => {
  const m = DEFAULT_VARIABLES.conditions;

  it("is 1 at the defaults", () => {
    expect(conditionFactor(rate("bed-installation.mulch-installation"), {}, m).factor).toBe(1);
  });

  it("puts access on material moves but not on trimming", () => {
    expect(conditionFactor(rate("bed-installation.mulch-installation"), { access: "tight" }, m).factor).toBeCloseTo(1.2);
    expect(conditionFactor(rate("plant-maintenance.medium-shrub-trimming"), { access: "tight" }, m).factor).toBe(1);
  });

  it("never puts weed density on the weed removal tasks, whose rates already differ by it", () => {
    expect(conditionFactor(rate("bed-preparation.heavy-weed-removal"), { weeds: "heavy" }, m).factor).toBe(1);
    expect(conditionFactor(rate("bed-preparation.bed-edging"), { weeds: "heavy" }, m).factor).toBeCloseTo(1.35);
  });

  it("multiplies conditions together, and says which applied", () => {
    const r = conditionFactor(rate("bed-preparation.bed-edging"), { weeds: "moderate", slope: "steep", soil: "rocky" }, m);
    expect(r.factor).toBeCloseTo(1.15 * 1.4 * 1.5);
    expect(r.applied.map((a) => a.key).sort()).toEqual(["slope", "soil", "weeds"]);
  });

  it("uses saved multipliers", () => {
    const saved = readVariables({ conditions: { slope: { steep: 2 } } });
    expect(conditionFactor(rate("lawn-services.push-mowing"), { slope: "steep" }, saved.conditions).factor).toBe(2);
  });
});

describe("quantities from measurements", () => {
  const area = { sf: 324, lf: 80, depthIn: 3, tasks: [] };

  it("takes a typed quantity first", () => {
    expect(deriveQuantity(rate("bed-preparation.bed-edging"), { key: "x", qty: 12 }, area)).toEqual({ qty: 12, how: "entered" });
  });

  it("works out mulch yards from area × depth ÷ 324", () => {
    expect(deriveQuantity(rate("bed-installation.mulch-installation"), { key: "x" }, area)!.qty).toBe(3);
  });

  it("works out stone tons at 1.4 a yard", () => {
    expect(deriveQuantity(rate("bed-installation.decorative-rock-installation"), { key: "x" }, { ...area, depthIn: 2 })!.qty).toBeCloseTo(2.8);
  });

  it("uses the area for SF and the edge for LF", () => {
    expect(deriveQuantity(rate("bed-preparation.light-weed-removal"), { key: "x" }, area)!.qty).toBe(324);
    expect(deriveQuantity(rate("bed-preparation.bed-edging"), { key: "x" }, area)!.qty).toBe(80);
  });

  it("leaves counted tasks to be counted", () => {
    expect(deriveQuantity(rate("plant-maintenance.small-shrub-trimming"), { key: "x" }, area)).toBeNull();
  });
});

describe("pay for performance", () => {
  it("splits the pool by weighted hours", () => {
    const people = p4pSplit(100_000, crewMembers(1, 1, 10, 1.5), 1500);
    expect(people[0].shareCents).toBe(60_000);
    expect(people[1].shareCents).toBe(40_000);
    expect(people.every((p) => !p.floorApplies)).toBe(true);
  });

  it("splits evenly at equal weights", () => {
    const people = p4pSplit(9000, crewMembers(1, 2, 8, 1), 0);
    expect(people.map((p) => p.shareCents)).toEqual([3000, 3000, 3000]);
  });

  it("never pays under minimum wage for the hours worked, when the job runs over", () => {
    // $100 pool, 2 people, estimated 3 hours: fine. They take 5.
    const over = p4pSplit(10_000, crewMembers(0, 2, 5, 1), 1500);
    expect(over[0].shareCents).toBe(5000);
    expect(over[0].floorCents).toBe(7500);
    expect(over[0].payCents).toBe(7500);
    expect(over[0].floorApplies).toBe(true);
  });

  it("says the hours at which the floor kicks in: share ÷ minimum wage", () => {
    const [p] = p4pSplit(15_000, crewMembers(0, 1, 4, 1), 1500);
    expect(p.floorFromHours).toBe(10);
  });

  it("gives nothing out of nothing, and still pays the floor", () => {
    const [p] = p4pSplit(0, crewMembers(1, 0, 2, 1.5), 1500);
    expect(p.shareCents).toBe(0);
    expect(p.payCents).toBe(3000);
  });
});

describe("capacity multiplier", () => {
  it("follows Jordan's table at its edges", () => {
    expect(capacityMultiplier(0)).toBe(2.0);
    expect(capacityMultiplier(0.5999)).toBe(2.0);
    expect(capacityMultiplier(0.6)).toBe(2.1);
    expect(capacityMultiplier(0.8)).toBe(2.2);
    expect(capacityMultiplier(0.9)).toBe(2.3);
    expect(capacityMultiplier(1)).toBe(2.4);
    expect(capacityMultiplier(1.7)).toBe(2.4);
  });

  it("implies the margins in the doc", () => {
    expect(impliedMargin(2)).toBeCloseTo(0.5);
    expect(impliedMargin(2.4)).toBeCloseTo(0.5833, 3);
  });

  it("labels the bands", () => {
    expect(bandLabel(DEFAULT_VARIABLES.bands, 0)).toBe("U < 60%");
    expect(bandLabel(DEFAULT_VARIABLES.bands, 1)).toBe("60% ≤ U < 80%");
    expect(bandLabel(DEFAULT_VARIABLES.bands, 4)).toBe("U ≥ 100%");
  });

  it("refuses a table that doesn't climb", () => {
    expect(readBands([{ below: 0.8, multiplier: 2 }, { below: 0.6, multiplier: 2.1 }, { below: null, multiplier: 2.2 }])).toBe(readBands(null));
  });
});

describe("indirect pool", () => {
  it("merges overlapping clock entries on a job: elapsed, not summed", () => {
    const h = 3_600_000;
    expect(
      elapsedMinutes([
        { jobId: "a", start: 0, end: 2 * h },
        { jobId: "a", start: h, end: 3 * h },
        { jobId: "a", start: 5 * h, end: 6 * h },
        { jobId: "b", start: 0, end: h },
      ])
    ).toBe(5 * 60);
  });

  it("uses the app's figures when told to and it has them, else the ones entered by hand", () => {
    const app = { ic90Cents: 900_000, pm90Minutes: null, bookedHours: 50, availableHours: 100, notes: [] };
    const p = resolvePool(DEFAULT_VARIABLES, app);
    expect(p.ic90Cents).toBe(900_000);
    expect(p.ic90Source).toBe("app");
    expect(p.pm90Source).toBe("manual");
    const manual = resolvePool(readVariables({ indirect: { source: "manual" } }), app);
    expect(manual.ic90Source).toBe("manual");
  });
});

describe("days", () => {
  it("fits the job into whole days, each paying its own drive and setup", () => {
    expect(daysFor({ onceMinutes: 300, perDayMinutes: 80, hoursPerDay: 8 })).toBe(1);
    expect(daysFor({ onceMinutes: 500, perDayMinutes: 80, hoursPerDay: 8 })).toBe(2);
    expect(daysFor({ onceMinutes: 0, perDayMinutes: 80, hoursPerDay: 8 })).toBe(0);
  });
});

describe("materials", () => {
  it("adds the same material up across areas, with waste, rounded up to what can be bought", () => {
    const m = rollUpMaterials([
      { area: "A", task: "bed-installation.mulch-installation", quantity: 2.2 },
      { area: "B", task: "bed-installation.mulch-installation", quantity: 1.1 },
      { area: "B", task: "bed-installation.landscape-fabric-installation", quantity: 100 },
    ]);
    const mulch = m.find((x) => x.key === "mulch")!;
    expect(mulch.order).toBe(3.5);
    expect(mulch.areas).toEqual(["A", "B"]);
    expect(mulch.costCents).toBe(3.5 * 3500);
    expect(m.find((x) => x.key === "fabric")!.order).toBe(110);
  });

  it("flags a material with no price as price needed, never a made-up number", () => {
    const [fabric] = rollUpMaterials([{ area: "A", task: "bed-installation.landscape-fabric-installation", quantity: 50 }]);
    expect(fabric.unitCents).toBeNull();
    expect(fabric.costCents).toBeNull();
    expect(fabric.source).toBe("Price needed");
  });

  it("takes the cheapest supplier price, converting tons to yards", () => {
    const mulch = MATERIALS.find((x) => x.key === "mulch")!;
    const p = priceFor(mulch, {
      supplierProducts: [
        { supplier: "A", kind: "mulch", name: "Double shred", unit: "yd", priceCents: 4200 },
        { supplier: "B", kind: "mulch", name: "Hardwood", unit: "yd", priceCents: 3900 },
      ],
      inventory: [],
    });
    expect(p).toMatchObject({ unitCents: 3900, supplier: "B" });
    const rock = MATERIALS.find((x) => x.key === "rock")!;
    expect(priceFor(rock, { supplierProducts: [{ supplier: "C", kind: "stone", name: "River rock", unit: "yd", priceCents: 7000 }], inventory: [] }).unitCents).toBe(5000);
  });

  it("uses an inventory cost only when the unit matches", () => {
    const fabric = MATERIALS.find((x) => x.key === "fabric")!;
    expect(priceFor(fabric, { supplierProducts: [], inventory: [{ name: "Landscape fabric 3x50", unit: "roll", costPerUnit: 25 }] }).unitCents).toBeNull();
    expect(priceFor(fabric, { supplierProducts: [], inventory: [{ name: "Landscape fabric", unit: "sq ft", costPerUnit: 0.12 }] }).unitCents).toBe(12);
  });
});

describe("the project", () => {
  const one: ProjectInput = {
    name: "Test",
    crew: { leads: 1, techs: 1 },
    driveMinutesEachWay: 20,
    areas: [{ id: "a", name: "A", sf: 300, confirmed: true, conditions: {}, tasks: [{ key: "bed-preparation.light-weed-removal" }] }],
  };

  it("works the price as Ĉ × μ(U), with Ĉ = DĈ + IR × PM̂", () => {
    const r = priceProject(one, DEFAULT_VARIABLES);
    // 300 SF ÷ 3 = 100 labour minutes ÷ 2 people = 50 on the clock, + 20 walkthrough/inspection,
    // + 20 setup/breakdown + 4×3 + 10 unloading + 40 drive = 152 minutes → 3 whole hours.
    expect(r.time.workClockMinutes).toBe(50);
    expect(r.time.days).toBe(1);
    expect(r.time.clockMinutes).toBe(152);
    expect(r.time.billedHours).toBe(3);
    expect(r.pmMinutes).toBe(180);
    expect(r.dcCents).toBe(0);
    const ir = 4_800_000 / 27_300;
    expect(r.irCents).toBeCloseTo(ir);
    expect(r.icCents).toBe(Math.round(ir * 180));
    expect(r.utilization).toBeCloseTo(0.7);
    expect(r.multiplier).toBe(2.1);
    expect(r.priceCents).toBe(Math.ceil((r.icCents * 2.1) / 100) * 100);
    expect(r.priceCents % 100).toBe(0);
  });

  it("pays the crew 38% of P − DĈ", () => {
    const r = priceProject({ ...one, direct: { delivery: 5000 } }, DEFAULT_VARIABLES);
    expect(r.labourRevenueCents).toBe(r.priceCents - r.dcCents);
    expect(r.p4p.poolCents).toBe(Math.round(r.labourRevenueCents * 0.38));
    expect(r.p4p.people.reduce((s, p) => s + p.shareCents, 0)).toBeCloseTo(r.p4p.poolCents, -1);
  });

  it("rounds a short job up to an hour", () => {
    const tiny = priceProject({ ...one, driveMinutesEachWay: 0, areas: [{ ...one.areas[0], sf: 3 }] }, readVariables({ logistics: { setup: 0, breakdown: 0, smallItemsPerDay: 0, largeItemsPerDay: 0, walkthrough: 0, inspection: 0 } }));
    expect(tiny.time.billedHours).toBe(1);
  });

  it("prices the sample with every section filled", () => {
    const r = priceProject(SAMPLE_PROJECT, DEFAULT_VARIABLES);
    expect(r.areas).toHaveLength(3);
    expect(r.areas.every((a) => a.tasks.every((t) => t.qty != null))).toBe(true);
    expect(r.materials.map((m) => m.key)).toEqual(["mulch", "rock", "fabric", "staples", "perennial", "shrub-3gal"]);
    expect(r.priceNeeded).toEqual(["Landscape fabric", "Landscape staples", "Perennials (quart)"]);
    expect(r.priceCents).toBeGreaterThan(0);
    expect(r.p4p.people).toHaveLength(2);
  });
});

describe("photo suggestions", () => {
  it("keeps only real conditions and listed tasks, counts only on counted tasks", () => {
    const s = cleanSuggestion(
      {
        weeds: "heavy",
        access: "unsure",
        slope: "flat",
        soil: "unsure",
        overgrowth: "overgrown",
        tasks: [
          { key: "plant-maintenance.medium-shrub-trimming", count: 6.4, why: "six shrubs by the porch" },
          { key: "plant-maintenance.medium-shrub-trimming", count: 2, why: "again" },
          { key: "bed-preparation.heavy-weed-removal", count: 300, why: "weeds" },
          { key: "made-up.task", count: 1, why: "no" },
        ],
        notes: "Can't see the back of the bed.",
      },
      PRODUCTION_RATES_SEED,
      "2026-11-08T00:00:00Z"
    );
    expect(s.conditions).toEqual({ weeds: "heavy", slope: "flat", overgrowth: "overgrown" });
    expect(s.tasks).toEqual([
      { key: "plant-maintenance.medium-shrub-trimming", qty: 6, why: "six shrubs by the porch" },
      { key: "bed-preparation.heavy-weed-removal", qty: null, why: "weeds" },
    ]);
  });
});

describe("reading saved variables", () => {
  it("falls back to the starting figures for anything missing or out of range", () => {
    const v = readVariables({ pay: { p4pShare: 4, minWageCents: "1650" }, rates: [{ key: "bed-preparation.light-weed-removal", unitsPerLaborMinute: 4 }] });
    expect(v.pay.p4pShare).toBe(0.38);
    expect(v.pay.minWageCents).toBe(1650);
    expect(v.rates).toHaveLength(97);
    expect(v.rates.find((r) => r.key === "bed-preparation.light-weed-removal")!.unitsPerLaborMinute).toBe(4);
  });

  it("never throws on rubbish", () => {
    expect(readVariables("nope")).toEqual(DEFAULT_VARIABLES);
    expect(readVariables(null)).toEqual(DEFAULT_VARIABLES);
  });
});

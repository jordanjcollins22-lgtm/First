import { describe, expect, it } from "vitest";

import { estimateAccuracy, materialHealth, median, overheadParity, rateCardHealth, type EstimatePair } from "@/lib/pricing-health";
import { PRODUCTION_SERVICES } from "@/lib/forward-pricing";

const TYPICAL = { "landscape-bed": 0.3, "lawn-care": 0.004, trimming: 10, "stone-removal": 0.25 };

function card(over: Partial<{ service_type_id: string; name: string; status: "active" | "pending" | "denied"; pricing_basis: "area" | "perimeter" | "count" | "flat"; estimated_hours: number | null; minutes_per_sqft: number | null; crew_size: number }>) {
  return { service_type_id: "landscape-bed", name: "Landscape Bed", status: "active" as const, pricing_basis: "area" as const, estimated_hours: null, minutes_per_sqft: null, crew_size: 2, ...over };
}

describe("rateCardHealth", () => {
  it("is the business's own timing when the card has minutes it can use", () => {
    const row = rateCardHealth([card({ minutes_per_sqft: 0.2 })], TYPICAL).find((r) => r.typeId === "landscape-bed")!;
    expect(row.state).toBe("own");
    expect(row.minutesPerUnit).toBe(0.2);
    expect(row.fix).toBeNull();
  });

  it("says a missing service runs on the typical figure and what to turn on", () => {
    const row = rateCardHealth([], TYPICAL).find((r) => r.typeId === "landscape-bed")!;
    expect(row.state).toBe("typical");
    expect(row.minutesPerUnit).toBe(0.3);
    expect(row.problem).toMatch(/Not an active service/);
    expect(row.fix).toMatch(/Turn on/);
  });

  it("does not count a pending service as on the card", () => {
    const row = rateCardHealth([card({ status: "pending", minutes_per_sqft: 0.2 })], TYPICAL).find((r) => r.typeId === "landscape-bed")!;
    expect(row.state).toBe("typical");
  });

  it("flags fixed hours as the same price for every size", () => {
    const row = rateCardHealth([card({ estimated_hours: 3 })], TYPICAL).find((r) => r.typeId === "landscape-bed")!;
    expect(row.state).toBe("flat");
    expect(row.problem).toMatch(/fixed 3 crew-hours/);
  });

  it("catches minutes the estimate ignores because of a perimeter basis", () => {
    const row = rateCardHealth([card({ pricing_basis: "perimeter", minutes_per_sqft: 0.2 })], TYPICAL).find((r) => r.typeId === "landscape-bed")!;
    expect(row.state).toBe("typical");
    expect(row.problem).toMatch(/not used/);
    expect(row.fix).toMatch(/by area/);
  });

  it("uses a counted service's minutes whatever its basis, as the estimate does", () => {
    const row = rateCardHealth([card({ service_type_id: "trimming", pricing_basis: "flat", minutes_per_sqft: 8 })], TYPICAL).find((r) => r.typeId === "trimming")!;
    expect(row.state).toBe("own");
  });

  it("says the bed conversions have nowhere on the card to be set", () => {
    const row = rateCardHealth([], TYPICAL).find((r) => r.typeId === "stone-removal")!;
    expect(row.state).toBe("typical");
    expect(row.problem).toMatch(/no service on the rate card/);
  });

  it("suggests a starting figure from Production rates in the card's terms", () => {
    const rows = rateCardHealth([], TYPICAL, { services: PRODUCTION_SERVICES, crewPeople: 2 });
    // Hand weed pulling: 600 sq ft a crew-hour, so 0.1 min per sq ft for a crew of 2.
    expect(rows.find((r) => r.typeId === "landscape-cleanup")!.suggestion).toMatch(/^0\.1 min per sq ft with a crew of 2/);
    // Mulch: 2.5 cu yd an hour at 108 sq ft a yard is 270 sq ft an hour.
    expect(rows.find((r) => r.typeId === "landscape-bed")!.suggestion).toMatch(/^0\.222 min per sq ft/);
    expect(rows.find((r) => r.typeId === "trimming")!.suggestion).toMatch(/^7\.5 min per shrub/);
  });
});

describe("materialHealth", () => {
  const mulch = { id: "m1", name: "Brown mulch", unit: "cubic yards", coverage_per_unit_sqft: 108, cost_per_unit: 35 };
  const rock = { id: "m2", name: "River rock", unit: "tons", coverage_per_unit_sqft: null, cost_per_unit: 80 };
  const seed = { id: "m3", name: "Grass seed", unit: "bags", coverage_per_unit_sqft: 1000, cost_per_unit: null };
  const rules = [
    { service_type_id: "landscape-bed", material_id: "m1", match_field: "material", match_value: "Mulch" },
    { service_type_id: "landscape-bed", material_id: "m2", match_field: "material", match_value: "Rock" },
    { service_type_id: "lawn-restoration", material_id: "m3", match_field: null, match_value: null },
  ];
  const typical = [{ name: /seed/i, cents: 170 }];

  it("is quiet when every material has a rule, a coverage and a cost", () => {
    const fine = [mulch, { ...rock, coverage_per_unit_sqft: 50 }, { ...seed, cost_per_unit: 60 }];
    expect(materialHealth(rules, fine, typical)).toEqual([]);
  });

  it("finds a material with no coverage and one with no cost", () => {
    const rows = materialHealth(rules, [mulch, rock, seed], typical);
    expect(rows.find((r) => r.materialId === "m2")?.problem).toBe("no-coverage");
    const seedRow = rows.find((r) => r.materialId === "m3")!;
    expect(seedRow.problem).toBe("no-cost");
    expect(seedRow.say).toMatch(/typical \$1\.70/);
  });

  it("finds a kind of spot priced with no material at all", () => {
    const rows = materialHealth(rules.slice(0, 1), [mulch], typical);
    const missing = rows.filter((r) => r.problem === "no-rule").map((r) => r.name);
    expect(missing).toEqual(["River rock", "Seed"]);
  });

  it("ignores materials on services the tap estimate never prices", () => {
    const rows = materialHealth([...rules, { service_type_id: "snow", material_id: "m9", match_field: null, match_value: null }], [mulch, { ...rock, coverage_per_unit_sqft: 50 }, { ...seed, cost_per_unit: 60 }, { id: "m9", name: "Salt", unit: "lb", coverage_per_unit_sqft: null, cost_per_unit: null }], typical);
    expect(rows).toEqual([]);
  });
});

describe("estimateAccuracy", () => {
  const pair = (jobId: string, estimate: number, proposal: number, choices: string[] = [], subtotal: number | null = null): EstimatePair => ({
    jobId,
    label: jobId,
    estimateCents: estimate,
    estimateSubtotalCents: subtotal,
    proposalCents: proposal,
    choices,
    status: "sent",
  });

  it("has nothing to say with no jobs", () => {
    const s = estimateAccuracy([]);
    expect(s.medianPct).toBeNull();
    expect(s.jobs).toEqual([]);
  });

  it("works out the median lean, the median miss and how many were close", () => {
    const s = estimateAccuracy([pair("a", 110_00, 100_00), pair("b", 70_00, 100_00), pair("c", 100_00, 100_00), pair("d", 150_00, 100_00)]);
    // +10, -30, 0, +50
    expect(s.medianPct).toBe(5);
    expect(s.medianAbsPct).toBe(20);
    expect(s.within).toBe(2);
    expect(s.high).toBe(1);
    expect(s.low).toBe(1);
    // Biggest miss first.
    expect(s.jobs.map((j) => j.jobId)).toEqual(["d", "b", "a", "c"]);
  });

  it("treats exactly the tolerance as close", () => {
    expect(estimateAccuracy([pair("a", 115_00, 100_00)]).within).toBe(1);
  });

  it("leaves out jobs with nothing on either side", () => {
    expect(estimateAccuracy([pair("a", 0, 100_00), pair("b", 100_00, 0)]).jobs).toEqual([]);
  });

  it("reports the lean before the cushion where it was kept", () => {
    const s = estimateAccuracy([pair("a", 120_00, 100_00, [], 100_00), pair("b", 120_00, 100_00)]);
    expect(s.medianPct).toBe(20);
    expect(s.medianSubtotalPct).toBe(0);
  });

  it("groups by what was tapped, counting a job once per choice", () => {
    const s = estimateAccuracy([pair("a", 120_00, 100_00, ["mulch", "trim", "mulch"]), pair("b", 80_00, 100_00, ["mulch"])]);
    const mulch = s.byChoice.find((c) => c.choice === "mulch")!;
    expect(mulch.jobs).toBe(2);
    expect(mulch.medianPct).toBe(0);
    expect(mulch.label).toBe("Fresh mulch");
    expect(s.byChoice.find((c) => c.choice === "trim")!.jobs).toBe(1);
  });
});

describe("median", () => {
  it("takes the middle, or the mean of the two middles", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("overheadParity", () => {
  const base = { overheadPercent: 10, multiplier: 2, crewCostPerHourCents: 2500 };

  it("is the same both ways on the flat percentage", () => {
    const p = overheadParity({ ...base, basis: "percent", perCrewHourCents: 1500 });
    expect(p.same).toBe(true);
    expect(p.example).toBeNull();
  });

  it("is the same both ways while there is nothing to spread", () => {
    expect(overheadParity({ ...base, basis: "per_diem", perCrewHourCents: null }).same).toBe(true);
  });

  it("prices a typical job both ways when proposals charge by the hour", () => {
    const p = overheadParity({ ...base, basis: "per_diem", perCrewHourCents: 1500 });
    expect(p.same).toBe(false);
    // 16 h × $25 + $300 = $700 direct; × 2 = $1,400.
    // Proposal: + 16 × $15 = $1,640. Estimate: × 1.10 = $1,540.
    expect(p.example!.staffCents).toBe(164_000);
    expect(p.example!.estimateCents).toBe(154_000);
    expect(p.example!.diffPct).toBe(-6.1);
    // $240 of overhead on $1,400 is 17.1%.
    expect(p.example!.matchingPercent).toBe(17.1);
    expect(p.detail).toMatch(/collects less/);
  });
});

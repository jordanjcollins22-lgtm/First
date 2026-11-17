import { describe, expect, it } from "vitest";

import { CUSHION, cushionFor, MIN_PRIOR_SAMPLES, priceSpots, type PriceSpotsInput, type SpotInput } from "./spot-price";
import type { AiSpotSize, SizePriors } from "./spot-sizing";

const pricing = (service_type_id: string, name: string, minutes_per_sqft: number | null, estimated_hours: number | null = null, pricing_basis = "area") => ({
  organization_id: "org",
  service_type_id,
  name,
  status: "active" as const,
  requested_by: null,
  requested_note: null,
  cogs: null,
  cost: null,
  cost_unit: "sqft",
  pricing_basis: pricing_basis as never,
  estimated_hours,
  minutes_per_sqft,
  crew_size: 2,
  how_to: null,
  scope_template: null,
  performed_by: "own" as const,
  partner_name: null,
  updated_at: "",
});

// Like the live rate card: beds timed by area, the rest left to typical rates.
const catalog = {
  servicePricing: [
    pricing("landscape-bed", "Landscape Bed", 0.1),
    pricing("landscape-cleanup", "Landscape Cleanup", null, null, "flat"),
    pricing("lawn-restoration", "Lawn Restoration", 0.02),
    pricing("trimming", "Trimming", null, null, "count"),
    pricing("plant-bush-removal", "Plant / Bush Removal", 20, null, "count"),
    pricing("plant-installation", "Plant Installation", null, null, "count"),
    pricing("soft-washing", "Soft Washing", null, null, "flat"),
    pricing("grading", "Grading", null, null, "flat"),
  ],
  materials: [
    { id: "m1", name: "Mulch", unit: "cubic yards", coverage_per_unit_sqft: 100, waste_factor_pct: 10, cost_per_unit: 40 },
    { id: "m2", name: "Rock", unit: "cubic yards", coverage_per_unit_sqft: 80, waste_factor_pct: 10, cost_per_unit: null },
  ] as never,
  serviceMaterialRules: [
    { id: "r1", service_type_id: "landscape-bed", material_id: "m1", match_field: "material", match_value: "Mulch", created_at: "" },
    { id: "r2", service_type_id: "landscape-bed", material_id: "m2", match_field: "material", match_value: "Rock", created_at: "" },
  ],
  crewCostPerHourCents: 3000,
  markup: { multiplier: 2, overheadPercent: 10, overheadPerCrewHourCents: null },
  measurementUnit: "sqft",
  measurementBasis: "area" as never,
};

const lot = { lotSqft: 12_000, structureSqft: 2400 };

const spot = (index: number, choices: string[], tracedSqft: number | null = null, area: string | null = "front"): SpotInput => ({ index, choices, tracedSqft, area });

function run(partial: Partial<PriceSpotsInput> & { spots: SpotInput[] }) {
  return priceSpots({ ai: [], priors: {}, lot, catalog, ...partial });
}

const ai = (index: number, areaSqft: number | null, confidence: AiSpotSize["confidence"], count: number | null = null): AiSpotSize => ({ index, areaSqft, count, confidence, notes: "" });

const prior = (serviceTypeId: string, medianSqft: number | null, samples: number, medianCount: number | null = null): SizePriors => ({
  [serviceTypeId]: { serviceTypeId, medianSqft, medianCount, samples },
});

describe("each spot priced on its own", () => {
  it("prices six big traced beds well above one small one, where the form's price pooled them", () => {
    const one = run({ spots: [spot(0, ["mulch"], 120)] });
    const six = run({ spots: [0, 1, 2, 3, 4, 5].map((i) => spot(i, ["mulch"], 500)) });
    expect(six.price.lines).toHaveLength(6);
    expect(six.price.subtotalCents).toBeGreaterThan(one.price.subtotalCents * 20);
    // Even with no sizes at all, six beds are more than one, spread over the yard.
    const parts = ["front", "back", "sides", "front", "back", "foundation"];
    const sixGuessed = run({ spots: parts.map((area, i) => spot(i, ["mulch"], null, area)) });
    expect(sixGuessed.price.subtotalCents).toBeGreaterThan(run({ spots: [spot(0, ["mulch"])] }).price.subtotalCents * 4);
  });

  it("doesn't let guessed taps in one part of the yard add up to more beds than it has", () => {
    // Lot 12,000, house 2,400: 9,700 sq ft of open yard, 2,910 in front.
    const one = run({ spots: [spot(0, ["mulch"])] });
    const six = run({ spots: [0, 1, 2, 3, 4, 5].map((i) => spot(i, ["mulch"])) });
    const total = six.sizing.reduce((sum, s) => sum + s.areaSqft!, 0);
    expect(total).toBeLessThanOrEqual(Math.ceil(2910 * 0.35) + 6);
    expect(total).toBeGreaterThan(one.sizing[0].areaSqft!);
    expect(six.price.lines[0].sizeFrom).toContain("5 other spots like it in the front yard");
    expect(six.sizing[0].confidence).toBe("low");
    // Traced beds are their own sizes and are never cut back.
    const traced = run({ spots: [0, 1, 2].map((i) => spot(i, ["mulch"], 900)) });
    expect(traced.sizing.map((s) => s.areaSqft)).toEqual([900, 900, 900]);
  });

  it("prices a spot through the rate card the way the form's price does", () => {
    const { price } = run({ spots: [spot(0, ["mulch"], 640)] });
    const [line] = price.lines;
    expect(line.label).toBe("Spot 1: bed prep and fresh mulch");
    expect(line.size).toBe("640 sq ft");
    expect(line.sizeFrom).toBe("traced on the map");
    expect(line.priceAs).toBe("Landscape Bed");
    // 0.1 min per sq ft × 2 crew on 640 sq ft.
    expect(line.crewHours).toBeCloseTo((0.1 / 60) * 640 * 2, 6);
    expect(line.materials[0]).toEqual(expect.objectContaining({ name: "Mulch", typical: false }));
    expect(line.labourCents + line.materialsCents + line.markupCents).toBe(line.priceCents);
  });

  it("labels every line by its spot, so the client sees which is which", () => {
    const { price } = run({ spots: [spot(0, ["mulch"], 200), spot(3, ["weeds"], 300)] });
    expect(price.lines.map((l) => l.label)).toEqual(["Spot 1: bed prep and fresh mulch", "Spot 4: weeds and cleanup"]);
  });
});

describe("where a spot's size comes from", () => {
  it("takes the traced outline over everything else", () => {
    const { sizing } = run({ spots: [spot(0, ["mulch"], 300)], ai: [ai(0, 900, "high")], priors: prior("landscape-bed", 500, 20) });
    expect(sizing[0]).toEqual(expect.objectContaining({ areaSqft: 300, source: "traced", confidence: "high", from: "Traced on the map" }));
  });

  it("takes a sure reading from the pictures over the business's history", () => {
    const { sizing, price } = run({ spots: [spot(0, ["mulch"])], ai: [ai(0, 420, "medium")], priors: prior("landscape-bed", 500, 20) });
    expect(sizing[0]).toEqual(expect.objectContaining({ areaSqft: 420, source: "ai", confidence: "medium" }));
    expect(price.lines[0].sizeFrom).toBe("from the satellite picture and your photos");
  });

  it("takes history over a reading the model doubts, and the doubtful reading over a share of the lot", () => {
    const withHistory = run({ spots: [spot(0, ["mulch"])], ai: [ai(0, 420, "low")], priors: prior("landscape-bed", 500, 20) });
    expect(withHistory.sizing[0]).toEqual(expect.objectContaining({ areaSqft: 500, source: "history", confidence: "medium" }));
    expect(withHistory.price.lines[0].sizeFrom).toContain("20 yards we've measured");

    const without = run({ spots: [spot(0, ["mulch"])], ai: [ai(0, 420, "low")] });
    expect(without.sizing[0]).toEqual(expect.objectContaining({ areaSqft: 420, source: "ai", confidence: "low" }));
  });

  it("ignores history with too few measured yards", () => {
    const { sizing } = run({ spots: [spot(0, ["mulch"])], priors: prior("landscape-bed", 500, MIN_PRIOR_SAMPLES - 1) });
    expect(sizing[0].source).toBe("typical");
    const enough = run({ spots: [spot(0, ["mulch"])], priors: prior("landscape-bed", 500, MIN_PRIOR_SAMPLES) });
    expect(enough.sizing[0].source).toBe("history");
  });

  it("ignores history for another service, and a prior with no median", () => {
    expect(run({ spots: [spot(0, ["mulch"])], priors: prior("lawn-restoration", 800, 30) }).sizing[0].source).toBe("typical");
    expect(run({ spots: [spot(0, ["mulch"])], priors: prior("landscape-bed", null, 30) }).sizing[0].source).toBe("typical");
  });

  it("falls back to one spot's share of its part of the yard, not the whole part", () => {
    const { sizing, price } = run({ spots: [spot(0, ["mulch"], null, "back")] });
    expect(sizing[0]).toEqual(expect.objectContaining({ source: "typical", confidence: "low" }));
    expect(price.lines[0].sizeFrom).toContain("back yard");
    // A bed is far less than the back yard's open ground.
    expect(sizing[0].areaSqft!).toBeLessThan(12_000 * 0.45 * 0.2);
    expect(sizing[0].areaSqft!).toBeGreaterThan(0);
  });

  it("sizes a bigger lot's typical bed bigger, and still sizes a spot with no lot", () => {
    const small = run({ spots: [spot(0, ["mulch"])], lot: { lotSqft: 6000, structureSqft: 1500 } });
    const big = run({ spots: [spot(0, ["mulch"])], lot: { lotSqft: 30_000, structureSqft: 3000 } });
    expect(big.sizing[0].areaSqft!).toBeGreaterThan(small.sizing[0].areaSqft!);
    const none = run({ spots: [spot(0, ["mulch"], null, null)], lot: null });
    expect(none.price.totalCents).toBeGreaterThan(0);
    expect(none.price.basis).toContain("typical 10,000 sq ft lot");
  });

  it("ignores a reading for another spot, and junk numbers", () => {
    const { sizing } = run({ spots: [spot(0, ["mulch"], 0)], ai: [ai(1, 900, "high"), ai(0, -5, "high")] });
    expect(sizing[0].source).toBe("typical");
  });
});

describe("two things on one spot", () => {
  it("uses the same ground for mulch and weeds, and weeds a bed being re-mulched in half the time", () => {
    const { price, sizing } = run({ spots: [spot(0, ["mulch", "weeds"], 400)] });
    const [bed, weeds] = price.lines;
    expect(bed.size).toBe("400 sq ft");
    expect(weeds.size).toBe("400 sq ft");
    expect(weeds.label).toBe("Spot 1: weeds pulled before the new bed");
    expect(weeds.priceCents).toBeGreaterThan(0);
    const alone = run({ spots: [spot(0, ["weeds"], 400)] }).price.lines[0];
    expect(weeds.crewHours).toBeCloseTo(alone.crewHours * 0.5, 6);
    expect(weeds.rate).toContain("bed prep");
    expect(sizing[0].areaSqft).toBe(400);
  });

  it("splits a bed asked for in both mulch and rock, as the form's price does", () => {
    const { price } = run({ spots: [spot(0, ["mulch", "rock"], 400)] });
    expect(price.lines.map((l) => l.size)).toEqual(["200 sq ft", "200 sq ft"]);
  });

  it("counts the bushes to trim in a traced bed from its size", () => {
    const { price, sizing } = run({ spots: [spot(0, ["trim"], 600)] });
    expect(price.lines[0].size).toBe("20 shrubs");
    expect(price.lines[0].rate).toContain("production rate");
    expect(sizing[0]).toEqual(expect.objectContaining({ areaSqft: 600, count: 20, source: "traced", confidence: "medium" }));
    const inBed = run({ spots: [spot(0, ["mulch", "trim"], 600)] });
    expect(inBed.price.lines[1].size).toBe("20 shrubs");
    expect(inBed.sizing[0]).toEqual(expect.objectContaining({ count: 20, source: "traced", confidence: "medium" }));
  });

  it("takes the picture's count for the first counted thing only", () => {
    const { price, sizing } = run({ spots: [spot(0, ["remove", "plants"])], ai: [ai(0, null, "high", 7)] });
    expect(price.lines.map((l) => l.size)).toEqual(["7 shrubs", "5 plants"]);
    expect(sizing[0].count).toBe(7);
    expect(price.lines[1].note).toContain("Labour only");
  });

  it("uses the business's own count when the picture has none", () => {
    const { price } = run({ spots: [spot(0, ["remove"])], priors: prior("plant-bush-removal", null, 12, 3.4) });
    expect(price.lines[0].size).toBe("3 shrubs");
    expect(price.lines[0].sizeFrom).toContain("12 yards");
  });

  it("doesn't wash the house once per tap: typical siding is shared over the wash spots", () => {
    const one = run({ spots: [spot(0, ["wash"], null, "foundation")] });
    const four = run({ spots: [0, 1, 2, 3].map((i) => spot(i, ["wash"], null, "foundation")) });
    expect(four.price.subtotalCents).toBeLessThanOrEqual(one.price.subtotalCents + 4);
    expect(one.sizing[0].areaSqft).toBeGreaterThan(0);
  });

  it("measures a traced house as its walls, and a wash on a bed spot from the house, not the bed", () => {
    // One storey where the county's house is the footprint drawn: 4 × 40 ft × 10 ft.
    const traced = run({ spots: [spot(0, ["wash"], 1600)], lot: { lotSqft: 12_000, structureSqft: 1600 } });
    expect(traced.price.lines[0].size).toBe("1,600 sq ft");
    expect(traced.price.lines[0].sizeFrom).toContain("walls");
    const mixed = run({ spots: [spot(0, ["mulch", "wash"], 150)] });
    expect(mixed.price.lines[0].size).toBe("150 sq ft");
    expect(mixed.price.lines[1].sizeFrom).toContain("siding");
  });
});

describe("the cushion", () => {
  it("is set by how far each size can be trusted", () => {
    expect(cushionFor("traced", "high")).toBe(CUSHION.traced);
    expect(cushionFor("ai", "high")).toBe(CUSHION.high);
    expect(cushionFor("ai", "medium")).toBe(CUSHION.medium);
    expect(cushionFor("history", "medium")).toBe(CUSHION.medium);
    expect(cushionFor("ai", "low")).toBe(CUSHION.low);
    expect(cushionFor("typical", "high")).toBe(CUSHION.typical);
    expect(CUSHION.traced).toBeLessThan(CUSHION.medium);
    expect(CUSHION.medium).toBeLessThan(CUSHION.typical);
  });

  it("carries less on a traced spot than a guessed one of the same size, and rounds up to $25", () => {
    const traced = run({ spots: [spot(0, ["mulch"], 500)] }).price;
    const history = run({ spots: [spot(0, ["mulch"])], priors: prior("landscape-bed", 500, 10) }).price;
    expect(traced.subtotalCents).toBe(history.subtotalCents);
    for (const p of [traced, history]) {
      expect(p.totalCents % 2500).toBe(0);
      expect(p.subtotalCents + p.premiumCents).toBe(p.totalCents);
    }
    expect(traced.totalCents).toBeGreaterThanOrEqual(traced.subtotalCents * (1 + CUSHION.traced));
    expect(traced.totalCents).toBeLessThan(traced.subtotalCents * (1 + CUSHION.traced) + 2500);
    expect(history.totalCents).toBeGreaterThanOrEqual(history.subtotalCents * (1 + CUSHION.medium));
    expect(history.totalCents).toBeLessThan(history.subtotalCents * (1 + CUSHION.medium) + 2500);
  });

  it("records the weakest size on a spot, since its cushion is the one the price leans on", () => {
    const { sizing } = run({ spots: [spot(0, ["mulch", "remove"], 300)] });
    expect(sizing[0]).toEqual(expect.objectContaining({ areaSqft: 300, count: 2, source: "typical", confidence: "low", from: "A typical spot" }));
  });
});

describe("nothing to price", () => {
  it("prices nothing when there are no spots", () => {
    const { price, sizing } = run({ spots: [] });
    expect(sizing).toEqual([]);
    expect(price.lines).toEqual([]);
    expect(price.totalCents).toBe(0);
    expect(price.premiumCents).toBe(0);
  });

  it("leaves 'not sure' and a patio to the visit", () => {
    const { price, sizing } = run({ spots: [spot(0, ["other"], 200), spot(1, ["patio"])] });
    expect(price.lines.map((l) => l.priceCents)).toEqual([null, null]);
    expect(price.lines.map((l) => l.label)).toEqual(["Spot 1: not sure, take a look", "Spot 2: patio or walkway"]);
    expect(price.lines[0].note).toBe("Priced on the visit.");
    expect(sizing.map((s) => s.priceCents)).toEqual([null, null]);
    expect(price.totalCents).toBe(0);
  });

  it("prices the rest of a spot that also asks for a look", () => {
    const { price, sizing } = run({ spots: [spot(0, ["mulch", "other"], 200)] });
    expect(price.lines[0].priceCents).toBeGreaterThan(0);
    expect(price.lines[1].priceCents).toBeNull();
    expect(sizing[0].priceCents).toBe(price.lines[0].priceCents);
  });

  it("drops choices it doesn't know and repeated ones, and a spot with none is sized as nothing", () => {
    const { price, sizing } = run({ spots: [spot(0, ["mulch", "mulch", "bogus"], 200), spot(1, [])] });
    expect(price.lines).toHaveLength(1);
    expect(sizing[0].choices).toEqual(["mulch"]);
    expect(sizing[1]).toEqual(expect.objectContaining({ priceCents: null, areaSqft: null, count: null }));
  });
});

describe("what it says it was worked from", () => {
  it("counts the spots by where their sizes came from", () => {
    const { price } = run({ spots: [spot(0, ["mulch"], 300), spot(1, ["mulch"], 200), spot(2, ["mulch"])] });
    expect(price.basis).toBe("3 spots, each priced on its own: 2 traced on the map, 1 a typical size from the county's lot size, 12,000 sq ft");
    expect(price.markup).toBe("× 2, then + 10% overhead");
    expect(price.crewRateCents).toBe(3000);
  });

  it("flags typical stand-ins so the rate card can be filled", () => {
    expect(run({ spots: [spot(0, ["weeds"], 300)] }).price.usesTypical).toBe(true);
    expect(run({ spots: [spot(0, ["mulch"], 300)] }).price.usesTypical).toBe(false);
  });
});

describe("each surface sized on its own", () => {
  const noCard = { ...catalog, servicePricing: [] };

  it("sizes a lawn patch tapped with a bed apart from the bed, not on the outline drawn round the bed", () => {
    const { price, sizing } = run({ spots: [spot(0, ["mulch", "lawn"], 300)], catalog: noCard });
    const [bed, lawn] = price.lines;
    expect(bed.size).toBe("300 sq ft");
    expect(lawn.size).not.toBe("300 sq ft");
    expect(lawn.sizeFrom).toContain("bare patch");
    expect(sizing[0].areaSqft).toBe(300);
    // The water on a bed spot is a typical wet corner, not the bed.
    const water = run({ spots: [spot(0, ["mulch", "water"], 1000)] }).price.lines[1];
    expect(water.size).toBe("300 sq ft");
  });

  it("never prices a bed on a wash reading: the picture's area on a bed spot is the bed", () => {
    // The picture is asked for the bed alone (areaChoiceFor), so 200 is the bed.
    const { price } = run({ spots: [spot(0, ["mulch", "wash"])], ai: [ai(0, 200, "high")] });
    expect(price.lines[0].size).toBe("200 sq ft");
    expect(price.lines[1].sizeFrom).toContain("siding");
  });

  it("holds a measured water area to a wet corner, so a reading of the yard is not a $3,000 regrade", () => {
    const read = run({ spots: [spot(0, ["water"], null, "back")], ai: [ai(0, 3000, "high")] });
    expect(read.price.lines[0].size).toBe("600 sq ft");
    expect(read.sizing[0].confidence).toBe("medium");
    expect(read.price.totalCents).toBeLessThan(1500_00);
  });

  it("holds a wild reading to a spot's worth and trusts it less", () => {
    const { price, sizing } = run({ spots: [spot(0, ["mulch"])], ai: [ai(0, 18_000, "high")] });
    expect(price.lines[0].size).toBe("2,500 sq ft");
    expect(sizing[0]).toEqual(expect.objectContaining({ source: "ai", confidence: "medium" }));
    expect(price.lines[0].sizeFrom).toContain("taken as 2,500 sq ft");
  });

  it("sets aside a reading far off the business's own median, either way", () => {
    const big = run({ spots: [spot(0, ["mulch"])], ai: [ai(0, 2400, "high")], priors: prior("landscape-bed", 300, 20) });
    expect(big.sizing[0]).toEqual(expect.objectContaining({ source: "history", areaSqft: 300 }));
    const tiny = run({ spots: [spot(0, ["mulch"])], ai: [ai(0, 5, "high")], priors: prior("landscape-bed", 300, 20) });
    expect(tiny.sizing[0].source).toBe("history");
    const near = run({ spots: [spot(0, ["mulch"])], ai: [ai(0, 600, "high")], priors: prior("landscape-bed", 300, 20) });
    expect(near.sizing[0]).toEqual(expect.objectContaining({ source: "ai", areaSqft: 600 }));
  });

  it("holds the business's median to one spot's worth of its part of the yard", () => {
    const { sizing, price } = run({
      spots: [0, 1, 2, 3, 4].map((i) => spot(i, ["weeds"])),
      priors: prior("landscape-cleanup", 3000, 6),
      lot: { lotSqft: 10_000, structureSqft: 2000 },
    });
    const total = sizing.reduce((sum, s) => sum + s.areaSqft!, 0);
    // Open yard 7,950; the front is 2,385 of it, and cleanup can be half of that.
    expect(total).toBeLessThanOrEqual(Math.ceil(2385 * 0.5) + 5);
    expect(price.totalCents).toBeLessThan(1000_00);
  });

  it("washes the house once on the history and picture paths too", () => {
    const walls = [0, 1, 2, 3].map((i) => spot(i, ["wash"], null, "foundation"));
    const history = run({ spots: walls, priors: prior("soft-washing", 2000, 10) });
    expect(history.sizing.reduce((sum, s) => sum + s.areaSqft!, 0)).toBe(2000);
    const read = run({ spots: walls, ai: walls.map((w) => ai(w.index, 2100, "high")) });
    expect(read.sizing.reduce((sum, s) => sum + s.areaSqft!, 0)).toBeCloseTo(2100, -1);
    expect(read.price.lines[0].sizeFrom).toContain("shared over the 4 spots to wash");
  });

  it("counts the storeys of a traced house from the county's living area, and prices the height", () => {
    // County 3,000 sq ft over a 1,500 sq ft footprint: two storeys.
    const lot2 = { lotSqft: 12_000, structureSqft: 3000 };
    const untraced = run({ spots: [spot(0, ["wash"])], lot: lot2, catalog: noCard });
    const traced = run({ spots: [spot(0, ["wash"], 1500)], lot: lot2, catalog: noCard });
    expect(traced.price.lines[0].size).toBe(`${Math.round(4 * Math.sqrt(1500) * 20).toLocaleString("en-US")} sq ft`);
    expect(traced.price.lines[0].rate).toContain("2 storeys");
    expect(traced.price.lines[0].sizeFrom).toContain("2 storeys");
    expect(traced.price.subtotalCents).toBeGreaterThan(untraced.price.subtotalCents);
  });
});

describe("a rate card that times a service as flat hours", () => {
  const flatCleanup = { ...catalog, servicePricing: [...catalog.servicePricing.filter((p) => p.service_type_id !== "landscape-cleanup"), pricing("landscape-cleanup", "Landscape Cleanup", null, 4, "flat")] };

  it("charges the job's hours once over all its spots, split by size, not once per spot", () => {
    const one = run({ spots: [spot(0, ["weeds"], 300)], catalog: flatCleanup });
    expect(one.price.lines[0].crewHours).toBe(4);
    const five = run({ spots: [0, 1, 2, 3, 4].map((i) => spot(i, ["weeds"], i === 0 ? 400 : 100)), catalog: flatCleanup });
    expect(five.price.lines.reduce((sum, l) => sum + l.crewHours, 0)).toBeCloseTo(4, 6);
    expect(five.price.lines[0].crewHours).toBeCloseTo(2, 6);
    expect(five.price.lines[0].rate).toContain("shared over 5 spots");
  });
});

describe("the cushion on sizes worked from an outline", () => {
  it("is the traced cushion only for a traced size still fully trusted", () => {
    expect(cushionFor("traced", "medium")).toBe(CUSHION.medium);
    // Bushes counted from a traced bed carry the middle cushion, not the traced one.
    const counted = run({ spots: [spot(0, ["trim"], 600)] }).price;
    const line = counted.lines[0].priceCents!;
    expect(counted.totalCents).toBeGreaterThanOrEqual(line * (1 + CUSHION.medium));
  });
});

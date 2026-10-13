import { describe, expect, it } from "vitest";

import { checkGuardrails, marginAt, type GuardrailInput, type GuardrailLine } from "@/lib/sales/price-guardrails";
import { DEFAULT_DIVISION_TARGETS, divisionOf, dominantDivision, readTargets } from "@/lib/sales/divisions";

const line = (over: Partial<GuardrailLine> = {}): GuardrailLine => ({
  area: "Front bed",
  label: "Hand weed pulling",
  division: "maintenance",
  hasRate: true,
  quantity: 400,
  priceCents: 100_000,
  ...over,
});

/**
 * A job priced by the equation: cost is the formula price times what is
 * left after the 50% gross profit and the 15% pool, i.e. 35%.
 */
const base = (over: Partial<GuardrailInput> = {}): GuardrailInput => ({
  priceCents: 100_000,
  formulaCents: 100_000,
  costCents: 35_000,
  sharesOfPrice: 0.15,
  lines: [line()],
  areasWithoutCardRate: [],
  targets: DEFAULT_DIVISION_TARGETS,
  ...over,
});

describe("margin", () => {
  it("is what is left after cost and the pool, over the price", () => {
    expect(marginAt(100_000, 35_000, 0.15)).toBeCloseTo(0.5);
    expect(marginAt(0, 10, 0.15)).toBe(0);
  });
});

describe("the guardrails", () => {
  it("passes a price at the formula with every rate in", () => {
    const result = checkGuardrails(base());
    expect(result.pass).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.marginPct).toBeCloseTo(0.5);
    expect(result.deviationPct).toBeCloseTo(0);
  });

  it("holds a line with no production rate, and says which", () => {
    const result = checkGuardrails(base({ lines: [line(), line({ label: "Dump run", hasRate: false })] }));
    expect(result.pass).toBe(false);
    expect(result.failed).toContain("rates");
    expect(result.reasons.join(" ")).toContain("No production rate for Dump run");
  });

  it("holds an area whose service has no rate on the rate card", () => {
    const result = checkGuardrails(base({ areasWithoutCardRate: ["Landscape Bed", "Landscape Bed"] }));
    expect(result.pass).toBe(false);
    expect(result.reasons[0]).toBe("No rate on the rate card for Landscape Bed.");
  });

  it("holds a line nobody measured", () => {
    const result = checkGuardrails(base({ lines: [line({ quantity: 0 })] }));
    expect(result.pass).toBe(false);
    expect(result.reasons.join(" ")).toContain("No quantity on Hand weed pulling (Front bed)");
  });

  it("holds a maintenance price under the formula, because maintenance must leave 50%", () => {
    // 10% under the formula is inside the tolerance but takes the margin under 50%.
    const result = checkGuardrails(base({ priceCents: 90_000 }));
    expect(result.pass).toBe(false);
    expect(result.failed).toEqual(["margin"]);
    expect(result.reasons[0]).toMatch(/under the maintenance target of 50%/);
  });

  it("lets an install price 10% under the formula through, because install's bar is 30%", () => {
    const result = checkGuardrails(base({ priceCents: 90_000, lines: [line({ division: "install", label: "Mulch install" })] }));
    expect(result.division).toBe("install");
    expect(result.pass).toBe(true);
  });

  it("holds a price more than 15% from the formula either way", () => {
    const under = checkGuardrails(base({ priceCents: 80_000, lines: [line({ division: "install" })] }));
    expect(under.failed).toEqual(["formula"]);
    expect(under.reasons[0]).toMatch(/20% under the formula price of \$1,000/);
    const over = checkGuardrails(base({ priceCents: 120_000 }));
    expect(over.failed).toEqual(["formula"]);
    expect(over.reasons[0]).toMatch(/over/);
  });

  it("accepts exactly 15% off for a division with room", () => {
    const result = checkGuardrails(base({ priceCents: 85_000, lines: [line({ division: "snow" })] }));
    expect(result.pass).toBe(true);
  });

  it("holds when there is no formula or no cost", () => {
    const result = checkGuardrails(base({ formulaCents: null, costCents: null }));
    expect(result.failed).toEqual(["margin", "formula"]);
  });

  it("carries other holds through as reasons", () => {
    const result = checkGuardrails(base({ otherHolds: ["Wording to approve on Front bed.", ""] }));
    expect(result.pass).toBe(false);
    expect(result.reasons).toEqual(["Wording to approve on Front bed."]);
  });

  it("uses the owner's targets", () => {
    const result = checkGuardrails(base({ priceCents: 90_000, targets: { ...DEFAULT_DIVISION_TARGETS, maintenance: 0.4 } }));
    expect(result.pass).toBe(true);
  });
});

describe("divisions", () => {
  it("knows the production rates", () => {
    expect(divisionOf("mowing-edging")).toBe("maintenance");
    expect(divisionOf("sod-install")).toBe("install");
    expect(divisionOf("snow-removal")).toBe("snow");
  });

  it("falls back to the words in the name", () => {
    expect(divisionOf("custom-1", "Drip irrigation repair")).toBe("irrigation");
    expect(divisionOf("salting")).toBe("snow");
    expect(divisionOf("custom-2", "Patio")).toBe("install");
  });

  it("judges a job by the division carrying most of the price", () => {
    expect(
      dominantDivision([
        { division: "maintenance", priceCents: 300 },
        { division: "install", priceCents: 900 },
      ])
    ).toBe("install");
  });

  it("reads stored targets and keeps defaults for nonsense", () => {
    expect(readTargets({ maintenance: 0.55, install: 3, snow: null })).toEqual({ ...DEFAULT_DIVISION_TARGETS, maintenance: 0.55 });
  });
});

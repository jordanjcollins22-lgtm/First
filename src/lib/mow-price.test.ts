import { describe, expect, it } from "vitest";

import type { LngLat, LotData } from "@/lib/lot-map";
import { dollars, estimateLawn, firstMowPrice, MOW_TIERS, neighbourTier, ringAreaSqft, tierByKey, tierFor } from "@/lib/mow-price";

/** A square this many feet across, at Harford County's latitude. */
function square(feet: number, at: LngLat = [-76.35, 39.5]): LngLat[] {
  const metres = feet / 3.28084;
  const dLat = metres / 110_574;
  const dLng = metres / (111_320 * Math.cos((at[1] * Math.PI) / 180));
  const [x, y] = at;
  return [
    [x, y],
    [x + dLng, y],
    [x + dLng, y + dLat],
    [x, y + dLat],
    [x, y],
  ];
}

const lot = (over: Partial<LotData>): LotData => ({ ring: square(100), footprint: null, front: null, frontRoad: null, lotSqft: null, structureSqft: null, ...over });

describe("sizing a lawn", () => {
  it("measures a ring of map points in square feet", () => {
    expect(ringAreaSqft(square(100))).toBeGreaterThan(9_900);
    expect(ringAreaSqft(square(100))).toBeLessThan(10_100);
  });

  it("takes the house off the lot, then the share that isn't grass", () => {
    const estimate = estimateLawn(lot({ lotSqft: 12_000, footprint: square(40) }))!;
    expect(estimate.houseSqft).toBeGreaterThan(1_580);
    expect(estimate.houseSqft).toBeLessThan(1_620);
    // (12,000 - 1,600) x 0.7 = 7,280, to the nearest hundred.
    expect(estimate.lawnSqft).toBe(7_300);
  });

  it("uses the drawn line when the county has no lot size", () => {
    expect(estimateLawn(lot({ lotSqft: null }))!.lawnSqft).toBe(7_000);
  });

  it("guesses one floor from the county's floor area when there is no outline", () => {
    const estimate = estimateLawn(lot({ lotSqft: 10_000, structureSqft: 3_000 }))!;
    expect(estimate.houseSqft).toBe(1_500);
    expect(estimate.lawnSqft).toBe(6_000);
  });

  it("has nothing to say without a lot", () => {
    expect(estimateLawn(null)).toBeNull();
  });
});

describe("pricing a mow", () => {
  it("puts a lawn in the smallest tier it fits", () => {
    expect(tierFor(3_000)?.key).toBe("small");
    expect(tierFor(5_000)?.key).toBe("small");
    expect(tierFor(5_001)?.key).toBe("medium");
    expect(tierFor(43_560)?.key).toBe("acre");
  });

  it("leaves more than an acre to a person", () => {
    expect(tierFor(43_561)).toBeNull();
  });

  it("goes up and down a tier, and stops at the ends", () => {
    expect(neighbourTier("medium", -1)?.key).toBe("small");
    expect(neighbourTier("medium", 1)?.key).toBe("large");
    expect(neighbourTier("small", -1)).toBeNull();
    expect(neighbourTier("acre", 1)).toBeNull();
  });

  it("takes 15% off the first mow, in whole dollars, never rounding against the client", () => {
    expect(firstMowPrice(tierByKey("medium")!)).toEqual({ regularCents: 5_500, discountCents: 900, firstMowCents: 4_600 });
    expect(firstMowPrice(tierByKey("small")!)).toEqual({ regularCents: 4_500, discountCents: 700, firstMowCents: 3_800 });
    for (const tier of MOW_TIERS) {
      const p = firstMowPrice(tier);
      expect(p.firstMowCents).toBeLessThanOrEqual(tier.cents * 0.85);
      expect(p.firstMowCents % 100).toBe(0);
    }
  });

  it("rises with the size of the lawn", () => {
    for (let i = 1; i < MOW_TIERS.length; i++) {
      expect(MOW_TIERS[i].cents).toBeGreaterThan(MOW_TIERS[i - 1].cents);
      expect(MOW_TIERS[i].upToSqft).toBeGreaterThan(MOW_TIERS[i - 1].upToSqft);
    }
  });

  it("writes a price the way a person says it", () => {
    expect(dollars(4_600)).toBe("$46");
    expect(dollars(4_650)).toBe("$46.50");
  });
});

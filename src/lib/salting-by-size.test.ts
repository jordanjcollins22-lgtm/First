import { describe, expect, it } from "vitest";
import { priceSaltingTogether, saltingMinutes, SALTING_RATE } from "@/lib/salting";
import { DEFAULT_SALT_SETTINGS } from "@/lib/salt";

const driveway = { petSafe: "Yes", surface: "Driveway", treatments: "3" };
const trip = (areaSqFt: number | null, each: number) => ({ toSiteMinutes: each, fromSiteMinutes: each, crewCostPerHourCents: 2667, feePct: 15, areaSqFt });

describe("salting timed by size", () => {
  it("takes the production rate's minutes on site", () => {
    expect(saltingMinutes(600)).toBeCloseTo(SALTING_RATE.setupMinutes + 6, 5);
    expect(saltingMinutes(1200)).toBeGreaterThan(saltingMinutes(600));
  });

  it("bills the minutes it takes, not a whole hour", () => {
    const [visit] = priceSaltingTogether([driveway], DEFAULT_SALT_SETTINGS, trip(380, 12));
    // 5 min setup + 3.8 min spreading + 24 min drive.
    expect(visit.visitBilledHours).toBeCloseTo((5 + 3.8 + 24) / 60, 3);
    expect(visit.labourCents).toBe(Math.round(((5 + 3.8 + 24) / 60) * 2667));
    expect(visit.materialCents).toBe(Math.round(380 * SALTING_RATE.materialCentsPerSqFt));
  });

  it("charges a bigger driveway more than a small one the same distance away", () => {
    const small = priceSaltingTogether([driveway], DEFAULT_SALT_SETTINGS, trip(380, 12))[0];
    const big = priceSaltingTogether([driveway], DEFAULT_SALT_SETTINGS, trip(2400, 12))[0];
    expect(big.labourCents).toBeGreaterThan(small.labourCents);
    expect(big.totalCents).toBeGreaterThan(small.totalCents);
  });

  it("still keeps half the price as gross profit after the fee", () => {
    const [visit] = priceSaltingTogether([driveway], DEFAULT_SALT_SETTINGS, trip(1044, 28.5));
    const cost = visit.labourCents + visit.materialCents + visit.perVisitCents * 0.15;
    expect(visit.perVisitCents - cost).toBeGreaterThanOrEqual(visit.perVisitCents * 0.5 - 1);
  });

  it("keeps the old whole hours when nobody measured it", () => {
    const [visit] = priceSaltingTogether([driveway], DEFAULT_SALT_SETTINGS, trip(null, 12));
    expect(visit.visitBilledHours).toBe(1);
  });
});

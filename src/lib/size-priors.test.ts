import { describe, expect, it } from "vitest";

import type { WorkZone } from "@/components/canvas/types";
import {
  MAX_AREA_SQFT,
  MAX_COUNT,
  MIN_SAMPLES,
  measuredZoneFrom,
  sizePriorsFrom,
  median,
  type MeasuredZone,
} from "./size-priors";

function zone(over: Partial<WorkZone> & { typeId?: string | null; values?: Record<string, string> } = {}): WorkZone {
  const { typeId = "landscape-bed", values = {}, ...rest } = over;
  return {
    id: "z",
    name: "Zone",
    color: "#000",
    points: [],
    location: "",
    service: typeId == null ? null : { typeId, values, notes: "", photos: [], tools: [] },
    areaSqFt: null,
    perimeterFt: null,
    ...rest,
  };
}

const areas = (service: string, values: number[], sold = false): MeasuredZone[] =>
  values.map((areaSqFt) => ({ serviceTypeId: service, areaSqFt, sold }));

describe("median", () => {
  it("is null below MIN_SAMPLES", () => {
    expect(median([])).toBeNull();
    expect(median([1, 2, 3, 4].slice(0, MIN_SAMPLES - 1))).toBeNull();
  });

  it("takes the middle of an odd list", () => {
    expect(median([5, 1, 3, 2, 4])).toBe(3);
  });

  it("averages the middle two of an even list", () => {
    expect(median([1, 2, 3, 4, 5, 6])).toBe(3.5);
  });

  it("is not pulled by a minority of huge values", () => {
    expect(median([1, 2, 3, 4, 5, 6, 7, 8, 1000])).toBe(5);
    expect(median([1, 2, 3, 4, 5, 6, 7, 9000, 9001, 9002])).toBe(5.5);
  });

  it("does not reorder the caller's list", () => {
    const values = [3, 1, 2, 5, 4];
    median(values);
    expect(values).toEqual([3, 1, 2, 5, 4]);
  });
});

describe("sizePriorsFrom", () => {
  it("is empty for no zones", () => {
    expect(sizePriorsFrom([])).toEqual({});
  });

  it("gives a median area per service", () => {
    const priors = sizePriorsFrom([...areas("bed", [100, 200, 300, 400, 500]), ...areas("lawn", [1000, 2000, 3000, 4000, 5000, 6000])]);
    expect(priors.bed).toEqual({ serviceTypeId: "bed", medianSqft: 300, medianCount: null, samples: 5 });
    expect(priors.lawn.medianSqft).toBe(3500);
    expect(priors.lawn.samples).toBe(6);
  });

  it("keeps a service with too few samples but with null medians", () => {
    const priors = sizePriorsFrom(areas("bed", [100, 200]));
    expect(priors.bed).toEqual({ serviceTypeId: "bed", medianSqft: null, medianCount: null, samples: 2 });
  });

  it("ignores nulls, zeros, negatives, NaN and infinities", () => {
    const priors = sizePriorsFrom([
      ...areas("bed", [100, 200, 300, 400, 500]),
      { serviceTypeId: "bed", areaSqFt: null },
      { serviceTypeId: "bed", areaSqFt: 0 },
      { serviceTypeId: "bed", areaSqFt: -50 },
      { serviceTypeId: "bed", areaSqFt: Number.NaN },
      { serviceTypeId: "bed", areaSqFt: Number.POSITIVE_INFINITY },
    ]);
    expect(priors.bed.medianSqft).toBe(300);
    expect(priors.bed.samples).toBe(5);
  });

  it("drops absurd values beyond the caps", () => {
    const priors = sizePriorsFrom([
      ...areas("bed", [100, 200, 300, 400, 500]),
      { serviceTypeId: "bed", areaSqFt: MAX_AREA_SQFT + 1 },
      { serviceTypeId: "bed", areaSqFt: 9_999_999 },
    ]);
    expect(priors.bed.medianSqft).toBe(300);
    expect(priors.bed.samples).toBe(5);

    const counts = sizePriorsFrom(
      [2, 4, 6, 8, 10, MAX_COUNT + 1].map((count) => ({ serviceTypeId: "trim", areaSqFt: null, count }))
    );
    expect(counts.trim.medianCount).toBe(6);
  });

  it("keeps a value right at the cap", () => {
    const priors = sizePriorsFrom(areas("lawn", [MAX_AREA_SQFT, MAX_AREA_SQFT, MAX_AREA_SQFT, MAX_AREA_SQFT, MAX_AREA_SQFT]));
    expect(priors.lawn.medianSqft).toBe(MAX_AREA_SQFT);
  });

  it("drops a zone with neither a usable area nor a count entirely", () => {
    const priors = sizePriorsFrom([{ serviceTypeId: "bed", areaSqFt: 0, count: 0 }]);
    expect(priors).toEqual({});
  });

  it("skips zones with no service id", () => {
    expect(sizePriorsFrom([{ serviceTypeId: "", areaSqFt: 100 }])).toEqual({});
  });

  it("judges area and count separately", () => {
    const zones: MeasuredZone[] = [
      { serviceTypeId: "trim", areaSqFt: 50, count: 3 },
      { serviceTypeId: "trim", areaSqFt: null, count: 4 },
      { serviceTypeId: "trim", areaSqFt: null, count: 5 },
      { serviceTypeId: "trim", areaSqFt: null, count: 6 },
      { serviceTypeId: "trim", areaSqFt: null, count: 7 },
    ];
    const priors = sizePriorsFrom(zones);
    expect(priors.trim).toEqual({ serviceTypeId: "trim", medianSqft: null, medianCount: 5, samples: 5 });
  });

  it("prefers sold jobs when there are enough of them", () => {
    const priors = sizePriorsFrom([...areas("bed", [100, 110, 120, 130, 140], true), ...areas("bed", [900, 900, 900, 900, 900, 900, 900])]);
    expect(priors.bed.medianSqft).toBe(120);
    expect(priors.bed.samples).toBe(5);
  });

  it("uses every job when sold ones are too few", () => {
    const priors = sizePriorsFrom([...areas("bed", [100, 110], true), ...areas("bed", [300, 400, 500])]);
    expect(priors.bed.medianSqft).toBe(300);
    expect(priors.bed.samples).toBe(5);
  });

  it("decides sold-only per measure, not per service", () => {
    const zones: MeasuredZone[] = [
      // Five sold counts, but only two sold areas.
      ...[1, 2, 3, 4, 5].map((count, i) => ({ serviceTypeId: "plants", areaSqFt: i < 2 ? 10 : null, count, sold: true })),
      ...[50, 60, 70].map((count) => ({ serviceTypeId: "plants", areaSqFt: 1000, count, sold: false })),
    ];
    const priors = sizePriorsFrom(zones);
    expect(priors.plants.medianCount).toBe(3);
    // Areas fall back to all five: 10, 10, 1000, 1000, 1000.
    expect(priors.plants.medianSqft).toBe(1000);
  });

  it("is why one small bed and six big beds no longer price alike", () => {
    // The point of the whole exercise: a typical bed on this business's jobs.
    const priors = sizePriorsFrom(areas("bed", [80, 95, 120, 140, 150, 160, 175, 200, 220, 4000]));
    expect(priors.bed.medianSqft).toBe(155);
  });
});

describe("measuredZoneFrom", () => {
  it("reads the area of an area zone", () => {
    expect(measuredZoneFrom(zone({ areaSqFt: 240, measurementKind: "area" }))).toEqual({
      serviceTypeId: "landscape-bed",
      areaSqFt: 240,
      count: null,
      sold: false,
    });
  });

  it("works the area out from length and width when it was never saved", () => {
    const m = measuredZoneFrom(zone({ lengthFt: 20, widthFt: 6 }));
    expect(m?.areaSqFt).toBe(120);
  });

  it("leaves out a run measured by length only", () => {
    expect(measuredZoneFrom(zone({ lengthFt: 80, measurementKind: "linear" }))).toBeNull();
    expect(measuredZoneFrom(zone({ lengthFt: 80 }))).toBeNull();
  });

  it("keeps a run's quantity even though it has no area", () => {
    const m = measuredZoneFrom(zone({ typeId: "trimming", lengthFt: 40, measurementKind: "linear", values: { quantity: "6" } }));
    expect(m).toEqual({ serviceTypeId: "trimming", areaSqFt: null, count: 6, sold: false });
  });

  it("reads the quantity field as the count", () => {
    const m = measuredZoneFrom(zone({ typeId: "plant-installation", values: { quantity: "12" } }), true);
    expect(m).toEqual({ serviceTypeId: "plant-installation", areaSqFt: null, count: 12, sold: true });
  });

  it("does not treat a blank or junk quantity as 1", () => {
    expect(measuredZoneFrom(zone({ typeId: "trimming", values: { quantity: "" } }))).toBeNull();
    expect(measuredZoneFrom(zone({ typeId: "trimming", values: { quantity: "  " } }))).toBeNull();
    expect(measuredZoneFrom(zone({ typeId: "trimming", values: { quantity: "lots" } }))).toBeNull();
    expect(measuredZoneFrom(zone({ typeId: "trimming", values: { quantity: "0" } }))).toBeNull();
  });

  it("returns null for a zone with no service", () => {
    expect(measuredZoneFrom(zone({ typeId: null, areaSqFt: 300 }))).toBeNull();
  });

  it("returns null for an unmeasured zone", () => {
    expect(measuredZoneFrom(zone({}))).toBeNull();
  });

  it("never reads the outline's canvas pixels as a size", () => {
    const m = measuredZoneFrom(
      zone({ points: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 500 }], anchor: { x: 250, y: 250 } })
    );
    expect(m).toBeNull();
  });

  it("feeds sizePriorsFrom end to end", () => {
    const zones = [100, 150, 200, 250, 300].map((a) => zone({ areaSqFt: a, measurementKind: "area" }));
    const measured = zones.map((z) => measuredZoneFrom(z)).filter((m): m is MeasuredZone => m != null);
    expect(sizePriorsFrom(measured)["landscape-bed"].medianSqft).toBe(200);
  });
});

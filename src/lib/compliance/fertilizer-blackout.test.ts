import { describe, expect, it } from "vitest";

import {
  checkFertilizerDay,
  checkFertilizerVisit,
  daysBetween,
  fertilizerWindowOn,
  isFertilizerService,
  nitrogenRateIn,
} from "./fertilizer-blackout";

describe("fertilizerWindowOn", () => {
  it("is open through Nov 15 and from Mar 1", () => {
    expect(fertilizerWindowOn("2026-11-15")).toBe("open");
    expect(fertilizerWindowOn("2027-03-01")).toBe("open");
    expect(fertilizerWindowOn("2026-07-04")).toBe("open");
  });
  it("is certified-only Nov 16 to Nov 30", () => {
    expect(fertilizerWindowOn("2026-11-16")).toBe("certified_only");
    expect(fertilizerWindowOn("2026-11-30")).toBe("certified_only");
  });
  it("is blackout Dec 1 to the end of February, leap day included", () => {
    expect(fertilizerWindowOn("2026-12-01")).toBe("blackout");
    expect(fertilizerWindowOn("2027-01-15")).toBe("blackout");
    expect(fertilizerWindowOn("2028-02-29")).toBe("blackout");
  });
});

describe("isFertilizerService", () => {
  it("recognises fertilizer wording", () => {
    for (const t of ["Fertilization", "Lawn fertiliser", "Weed & feed", "weed and feed", "Fall winterizer", "Starter fertilizer with seed", "Lawn feeding"]) {
      expect(isFertilizerService(t)).toBe(true);
    }
  });
  it("leaves pesticides, lime, potash and irrigation alone", () => {
    for (const t of ["Weed Control", "Lime application", "Potash", "Winterize irrigation", "Mowing", "Overseeding", "", null]) {
      expect(isFertilizerService(t)).toBe(false);
    }
  });
});

describe("nitrogenRateIn", () => {
  it("reads a written rate", () => {
    expect(nitrogenRateIn("Fertilization at 0.5 lb N per 1000")).toBe(0.5);
    expect(nitrogenRateIn("0.75 lbs of nitrogen")).toBe(0.75);
    expect(nitrogenRateIn("Fertilization")).toBeNull();
  });
});

describe("checkFertilizerDay", () => {
  it("blocks the blackout with a clear message", () => {
    const v = checkFertilizerDay("2026-12-10", { certifiedOnFile: true });
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/March 1/);
  });
  it("blocks late fall without a certification", () => {
    expect(checkFertilizerDay("2026-11-20", { certifiedOnFile: false }).ok).toBe(false);
  });
  it("allows late fall for a certified applicator at or under 0.5 lb N", () => {
    const v = checkFertilizerDay("2026-11-20", { certifiedOnFile: true, nitrogenLbPer1000: 0.5 });
    expect(v.ok).toBe(true);
    expect(v.message).toMatch(/0\.5 lb/);
    expect(checkFertilizerDay("2026-11-20", { certifiedOnFile: true }).ok).toBe(true);
  });
  it("blocks a late-fall rate over 0.5 lb N", () => {
    expect(checkFertilizerDay("2026-11-20", { certifiedOnFile: true, nitrogenLbPer1000: 0.75 }).ok).toBe(false);
  });
  it("allows any day in season", () => {
    expect(checkFertilizerDay("2026-04-10", { certifiedOnFile: false })).toEqual({ ok: true, window: "open", message: null });
  });
});

describe("checkFertilizerVisit", () => {
  it("ignores visits with no fertilizer on them", () => {
    expect(checkFertilizerVisit({ startsOn: "2027-01-05", endsOn: "2027-01-05", lines: ["Mowing", "Lime application"], certifiedOnFile: false }).ok).toBe(true);
  });
  it("finds the first blocked day in a range that runs into the blackout", () => {
    const v = checkFertilizerVisit({ startsOn: "2026-11-29", endsOn: "2026-12-02", lines: ["Fertilization"], certifiedOnFile: true });
    expect(v.ok).toBe(false);
    expect(v.day).toBe("2026-12-01");
  });
  it("passes a certified late-fall visit with the caution attached", () => {
    const v = checkFertilizerVisit({ startsOn: "2026-11-18", endsOn: "2026-11-18", lines: ["Fertilization"], certifiedOnFile: true });
    expect(v.ok).toBe(true);
    expect(v.window).toBe("certified_only");
  });
});

describe("daysBetween", () => {
  it("lists every day inclusive", () => {
    expect(daysBetween("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
  });
});

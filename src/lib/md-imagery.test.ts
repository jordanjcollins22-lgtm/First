import { describe, expect, it } from "vitest";

import { countyKey, newestYearInName, parseFlightYears, pickNewest } from "@/lib/md-imagery";

// The services' own descriptions, as published.
const SIX_INCH =
  "<div style='text-align:Left;'><p><span>This service provides six inch resolution aerial imagery for the State of Maryland. The imagery for this service is composed of imagery flown in 2023 (Southern Western Shore: Anne Arundel, Calvert, Charles, Howard, Montgomery, Prince George's St. Mary's), 2024 (Eastern Shore), and 2025 (Northern Western Shore: Allegany, Baltimore City, Baltimore County, Carroll, Frederick, Garrett, Harford, Washington). </span></p></div>";
const THREE_INCH =
  "This image service provides Three Inch resolution aerial imagery for the State of Maryland. The imagery for this service is composed of imagery flown in 2020 (Gaithersburg, Rockville), 2023 (Anne Arundel County), 2024 (Eastern Shore), and 2025 (Western Shore).";

describe("countyKey", () => {
  it("reads a county the same however it is written", () => {
    expect(countyKey("Prince George's County")).toBe(countyKey("prince georges"));
    expect(countyKey("St. Mary's County")).toBe(countyKey("Saint Marys"));
    expect(countyKey("Harford County")).toBe("harford");
  });

  it("keeps Baltimore City apart from Baltimore County", () => {
    expect(countyKey("Baltimore city")).toBe("baltimore city");
    expect(countyKey("Baltimore County")).toBe("baltimore");
  });
});

describe("parseFlightYears", () => {
  it("reads the six-inch service's years by county", () => {
    const years = parseFlightYears(SIX_INCH);
    expect(years.get(countyKey("Harford County"))).toBe(2025);
    expect(years.get(countyKey("Baltimore city"))).toBe(2025);
    expect(years.get(countyKey("Baltimore County"))).toBe(2025);
    expect(years.get(countyKey("Anne Arundel County"))).toBe(2023);
    expect(years.get(countyKey("Talbot County"))).toBe(2024);
    expect(years.get(countyKey("Cecil County"))).toBe(2024);
  });

  it("finds two counties the published text ran together without a comma", () => {
    const years = parseFlightYears(SIX_INCH);
    expect(years.get(countyKey("Prince George's County"))).toBe(2023);
    expect(years.get(countyKey("St. Mary's County"))).toBe(2023);
  });

  it("reads the three-inch service, where towns and whole shores are named", () => {
    const years = parseFlightYears(THREE_INCH);
    expect(years.get(countyKey("Montgomery County"))).toBe(2020);
    expect(years.get(countyKey("Anne Arundel County"))).toBe(2023);
    expect(years.get(countyKey("Worcester County"))).toBe(2024);
    expect(years.get(countyKey("Harford County"))).toBe(2025);
  });

  it("is empty for text with no years", () => {
    expect(parseFlightYears("Aerial imagery of Maryland.").size).toBe(0);
  });
});

describe("newestYearInName", () => {
  it("takes the newest year in a service's name", () => {
    expect(newestYearInName("SixInch/SixInchImagery2023_2024_2025")).toBe(2025);
    expect(newestYearInName("Orthophotos/WM2025EV")).toBe(2025);
    expect(newestYearInName("SixInch/SixInchImagery")).toBeNull();
  });
});

describe("pickNewest", () => {
  it("takes the newest photo, then the sharpest", () => {
    const picked = pickNewest([
      { id: "six", year: 2025, inches: 6 },
      { id: "three", year: 2025, inches: 3 },
      { id: "old-three", year: 2020, inches: 3 },
    ]);
    expect(picked?.id).toBe("three");
    expect(pickNewest([{ id: "old-three", year: 2020, inches: 3 }, { id: "six", year: 2023, inches: 6 }])?.id).toBe("six");
    expect(pickNewest([])).toBeNull();
  });
});

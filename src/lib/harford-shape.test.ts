import { describe, expect, it } from "vitest";

import { insideHarford } from "./harford-shape";

describe("insideHarford", () => {
  it("knows the county's own towns", () => {
    expect(insideHarford(39.5359, -76.3483)).toBe(true); // Bel Air
    expect(insideHarford(39.4665, -76.2983)).toBe(true); // Abingdon
    expect(insideHarford(39.5096, -76.1641)).toBe(true); // Aberdeen
    expect(insideHarford(39.5493, -76.0916)).toBe(true); // Havre de Grace
    expect(insideHarford(39.6046, -76.4775)).toBe(true); // Jarrettsville
    expect(insideHarford(39.7093, -76.3494)).toBe(true); // Whiteford
    expect(insideHarford(39.5143, -76.4108)).toBe(true); // Fallston
  });

  it("knows the neighbours are not Harford", () => {
    expect(insideHarford(39.4015, -76.6019)).toBe(false); // Towson, Baltimore County
    expect(insideHarford(39.4126, -76.4636)).toBe(false); // Perry Hall, Baltimore County
    expect(insideHarford(39.4479, -76.4172)).toBe(false); // Kingsville, Baltimore County
    expect(insideHarford(39.6046, -76.1127)).toBe(false); // Port Deposit, Cecil County
    expect(insideHarford(39.6068, -75.8333)).toBe(false); // Elkton, Cecil County
    expect(insideHarford(39.7392, -104.9903)).toBe(false); // Denver
  });
});

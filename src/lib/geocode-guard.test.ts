import { describe, expect, it } from "vitest";

import {
  REGION,
  firstAcceptable,
  guardMatch,
  hasStreetLine,
  pointOutsideRegion,
  stateIn,
  tooThinToPlace,
  zipIn,
} from "./geocode-guard";

const BEL_AIR = { fullAddress: "8 Brooks Rd, Bel Air, Maryland 21014, United States", lat: 39.53, lng: -76.34 };
const ONTARIO = {
  fullAddress: "1103 Sunset Drive, Fort Frances, Ontario P9A 2T6, Canada",
  lat: 48.61,
  lng: -93.4,
};
const MEMPHIS = { fullAddress: "1103 Sunset Dr, Memphis, Tennessee 38111, United States", lat: 35.11, lng: -89.94 };

describe("stateIn", () => {
  it("reads a spelled-out state", () => {
    expect(stateIn("8 Brooks Rd, Bel Air, Maryland, 21014")).toBe("MD");
    expect(stateIn("1103 Sunset Drive, Fort Frances, Ontario P9A 2T6")).toBe("ON");
  });

  it("reads a two-letter code before the ZIP", () => {
    expect(stateIn("8 Brooks Rd, Bel Air, MD 21014")).toBe("MD");
  });

  it("does not mistake a street word for a state", () => {
    expect(stateIn("8 Brooks Rd")).toBeNull();
  });
});

describe("zipIn", () => {
  it("takes the ZIP off the end", () => {
    expect(zipIn("8 Brooks Rd, Bel Air, MD 21014")).toBe("21014");
    expect(zipIn("8 Brooks Rd, Bel Air, MD 21014, USA")).toBe("21014");
  });

  it("ignores a house number at the front", () => {
    expect(zipIn("21014 Long Road, Somewhere")).toBeNull();
  });
});

describe("guardMatch", () => {
  it("accepts the right street in the right state", () => {
    expect(guardMatch("8 Brooks Rd, Bel Air, Maryland, 21014", BEL_AIR).accepted).toBe(true);
  });

  it("refuses a Canadian answer to an American question", () => {
    // The reported bug: a thin address matched a real street in Ontario.
    const verdict = guardMatch("1103 Sunset Drive", ONTARIO);
    expect(verdict.accepted).toBe(false);
    expect(verdict.code).toBe("different_country");
  });

  it("refuses a different state when the address named one", () => {
    const verdict = guardMatch("1103 Sunset Dr, Bel Air, Maryland", MEMPHIS);
    expect(verdict.accepted).toBe(false);
    expect(verdict.code).toBe("different_state");
  });

  it("refuses a different ZIP when the address carried one", () => {
    const verdict = guardMatch("8 Brooks Rd, Bel Air, MD 21014", {
      ...BEL_AIR,
      fullAddress: "8 Brooks Rd, Elsewhere, MD 21921",
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.code).toBe("different_zip");
  });

  it("refuses anything a long way outside the region, state or not", () => {
    const verdict = guardMatch("1103 Sunset Dr", MEMPHIS);
    expect(verdict.accepted).toBe(false);
    expect(verdict.code).toBe("outside_region");
  });

  it("keeps a real client who genuinely lives out of county", () => {
    // Elkton and Ocean City are real customers, not mismatches. The box is
    // deliberately far wider than Harford.
    for (const point of [
      { fullAddress: "107 Highland Dr, Elkton, MD 21921", lat: 39.6, lng: -75.83 },
      { fullAddress: "4100 Coastal Hwy, Ocean City, MD 21842", lat: 38.36, lng: -75.07 },
      { fullAddress: "1 Market St, Philadelphia, PA 19106", lat: 39.95, lng: -75.14 },
    ]) {
      expect(guardMatch(point.fullAddress, point).accepted).toBe(true);
    }
  });

  it("lets a Canadian address through when that is what was asked for", () => {
    expect(guardMatch("1103 Sunset Drive, Fort Frances, Ontario, Canada", ONTARIO).code).not.toBe(
      "different_country"
    );
  });

  it("draws its box around the mid-Atlantic, not the county", () => {
    expect(REGION.north).toBeGreaterThan(40);
    expect(REGION.south).toBeLessThan(38);
  });
});

describe("firstAcceptable", () => {
  it("walks past a wrong-country answer to the right one underneath it", () => {
    const { match } = firstAcceptable("1103 Sunset Dr, Bel Air, Maryland", [ONTARIO, BEL_AIR]);
    expect(match?.fullAddress).toContain("Bel Air");
  });

  it("gives back why when nothing in the list works", () => {
    const { match, reason } = firstAcceptable("1103 Sunset Drive", [ONTARIO, MEMPHIS]);
    expect(match).toBeNull();
    expect(reason).toMatch(/canada/i);
  });

  it("says plainly when the geocoder had nothing", () => {
    expect(firstAcceptable("nowhere at all", []).reason).toMatch(/no match/i);
  });
});

describe("tooThinToPlace", () => {
  it("refuses a street with no town, which is what produced Ontario", () => {
    expect(tooThinToPlace("1103 Sunset Drive")).toBe(true);
  });

  it("accepts anything naming a place", () => {
    expect(tooThinToPlace("1103 Sunset Drive, Bel Air")).toBe(false);
    expect(tooThinToPlace("1103 Sunset Drive Maryland")).toBe(false);
    expect(tooThinToPlace("1103 Sunset Drive 21014")).toBe(false);
  });

  it("refuses something too short to be an address", () => {
    expect(tooThinToPlace("MD")).toBe(true);
    expect(tooThinToPlace("   ")).toBe(true);
  });
});

describe("pointOutsideRegion", () => {
  it("catches a pin that is already on the map in the wrong country", () => {
    // These were written before anything checked, and their address text
    // often looks fine — it is the coordinates that are wrong.
    expect(pointOutsideRegion(48.61, -93.4)).toBe(true);
    expect(pointOutsideRegion(35.11, -89.94)).toBe(true);
  });

  it("leaves a real one alone", () => {
    expect(pointOutsideRegion(39.53, -76.34)).toBe(false);
    expect(pointOutsideRegion(38.36, -75.07)).toBe(false);
  });

  it("does not treat an unplaced row as misplaced", () => {
    expect(pointOutsideRegion(0, 0)).toBe(false);
    expect(pointOutsideRegion(null, null)).toBe(false);
  });
});

describe("hasStreetLine", () => {
  it("accepts an address that names a building", () => {
    expect(hasStreetLine("8 Brooks Rd, Bel Air, MD 21014")).toBe(true);
    expect(hasStreetLine("1315 Amedoro Ct, Abingdon, Maryland, 21009")).toBe(true);
    expect(hasStreetLine("11824B Pulaski Hwy, Joppa, MD")).toBe(true);
  });

  it("refuses a town, which is what a contact export is full of", () => {
    // A geocoder answers "FALLSTON, MD 21160" with the middle of Fallston: a
    // real coordinate, a plausible pin, and nobody's house.
    expect(hasStreetLine("FALLSTON, MD 21160")).toBe(false);
    expect(hasStreetLine("DETROIT, MI 48237")).toBe(false);
    expect(hasStreetLine("BEL AIR, MD 21015")).toBe(false);
  });

  it("refuses a PO box, which is not a place a crew can drive to", () => {
    expect(hasStreetLine("PO Box 417, Bel Air, MD 21014")).toBe(false);
    expect(hasStreetLine("P.O. BOX 12")).toBe(false);
  });

  it("refuses a bare ZIP", () => {
    expect(hasStreetLine("21014")).toBe(false);
  });
});

describe("tooThinToPlace with a town-only address", () => {
  it("leaves a town unplaced rather than pinning its centre", () => {
    expect(tooThinToPlace("FALLSTON, MD 21160")).toBe(true);
    expect(tooThinToPlace("BEL AIR, MD 21015")).toBe(true);
  });

  it("still places a proper address", () => {
    expect(tooThinToPlace("8 Brooks Rd, Bel Air, MD 21014")).toBe(false);
  });

  it("still refuses a street with nowhere to put it", () => {
    expect(tooThinToPlace("1103 Sunset Drive")).toBe(true);
  });
});

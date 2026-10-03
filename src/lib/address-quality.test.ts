import { describe, expect, it } from "vitest";

import {
  assessAddress,
  canLinkAutomatically,
  claimsHarford,
  streetPrefix,
  withinHarford,
  NORMALIZER_VERSION,
} from "@/lib/address-quality";
import { normalizeAddress } from "@/lib/address-normalize";

/** Real coordinates, for the places the CRM actually pinned things. */
const BEL_AIR = { lat: 39.5359, lng: -76.3483 };
const MILAN_MISSOURI = { lat: 40.2017, lng: -93.1249 };
const PORT_MACQUARIE = { lat: -31.4333, lng: 152.9083 };

describe("withinHarford", () => {
  it("accepts a Bel Air pin", () => {
    expect(withinHarford(BEL_AIR.lat, BEL_AIR.lng)).toBe(true);
  });

  it("accepts Havre de Grace, at the eastern edge", () => {
    expect(withinHarford(39.5493, -76.0916)).toBe(true);
  });

  it("rejects Missouri", () => {
    expect(withinHarford(MILAN_MISSOURI.lat, MILAN_MISSOURI.lng)).toBe(false);
  });

  it("rejects the southern hemisphere", () => {
    expect(withinHarford(PORT_MACQUARIE.lat, PORT_MACQUARIE.lng)).toBe(false);
  });

  it("is false rather than throwing when there is no pin", () => {
    expect(withinHarford(null, null)).toBe(false);
  });
});

describe("claimsHarford", () => {
  it.each([
    "1550 Swearingen Drive, Bel Air, Maryland 21014, United States",
    "801 Long Drive, Aberdeen, Maryland 21001, United States",
    "3610 Ady Road, Street, Maryland 21154, United States",
    "1343 Lewis Lane, Havre de Grace, Maryland 21078, United States",
  ])("recognises %s", (address) => {
    expect(claimsHarford(address)).toBe(true);
  });

  it("recognises a Harford town without its ZIP", () => {
    expect(claimsHarford("Emmorton Road, Edgewood, Maryland")).toBe(true);
  });

  it("does not claim the other Aberdeen", () => {
    // A town name alone is not evidence: there is an Aberdeen in Scotland,
    // Washington and New Jersey, and the CRM has a record for one of them.
    expect(claimsHarford("64 Aberdeen Avenue, Toronto, Ontario M4X 1A2, Canada")).toBe(false);
  });

  it("does not claim a neighbouring county", () => {
    expect(claimsHarford("11824 Harford Road, Glen Arm, Maryland 21057")).toBe(false);
  });

  it("does not claim an address with nothing in it", () => {
    expect(claimsHarford("")).toBe(false);
    expect(claimsHarford(null)).toBe(false);
  });
});

describe("assessAddress", () => {
  it("passes an ordinary Harford house", () => {
    const seen = assessAddress("1550 Swearingen Drive, Bel Air, Maryland 21014", BEL_AIR);
    expect(seen.kind).toBe("house");
    expect(seen.needsReview).toBe(false);
    expect(seen.reasons).toEqual([]);
  });

  it("holds back a street with no house number", () => {
    // One pin on a road with four hundred houses would make every count wrong.
    const seen = assessAddress("Emmorton Road, Edgewood, Maryland 21040", BEL_AIR);
    expect(seen.kind).toBe("street");
    expect(seen.needsReview).toBe(true);
    expect(seen.reasons[0]).toContain("no house number");
  });

  it("holds back an address that normalises to nothing", () => {
    expect(assessAddress("", null).kind).toBe("unusable");
    expect(assessAddress(null, null).needsReview).toBe(true);
  });

  it("flags a Harford address pinned in Missouri", () => {
    // The real one: Bel Air's Red Pump Road, geocoded to Milan, Missouri.
    const seen = assessAddress("Red Pump Road, Bel Air, Maryland 21014", MILAN_MISSOURI);
    expect(seen.claimsHarford).toBe(true);
    expect(seen.needsReview).toBe(true);
    expect(seen.reasons.join(" ")).toMatch(/miles away/);
  });

  it("says how far wrong the pin is, in miles somebody can act on", () => {
    const seen = assessAddress("Red Pump Road, Bel Air, Maryland 21014", MILAN_MISSOURI);
    expect(seen.metresFromHarford).toBeGreaterThan(1_000_000);
    expect(seen.reasons.join(" ")).toMatch(/about \d+ miles away/);
  });

  it("flags a Harford address pinned in Australia", () => {
    const seen = assessAddress("319 Crestwood Drive, Edgewood, Maryland 21040", PORT_MACQUARIE);
    expect(seen.needsReview).toBe(true);
  });

  it("holds back an address pinned outside the service area entirely", () => {
    // Never claimed Harford, so nothing contradicts itself -- and it is still
    // not a house to draw on a Harford map without somebody looking.
    const seen = assessAddress("102 Barton Court, San Antonio, Texas 78225", {
      lat: 29.4241,
      lng: -98.4936,
    });
    expect(seen.claimsHarford).toBe(false);
    expect(seen.needsReview).toBe(true);
    expect(seen.reasons.join(" ")).toMatch(/miles from the service area/);
  });

  it("catches the rewritten address the mismatch rule cannot see", () => {
    // "319 Crestwood Drive, Edgewood" came back as the same house number and
    // street in Port Macquarie. The text stopped claiming Harford, so only the
    // distance is left to notice it.
    const seen = assessAddress(
      "319 Crestwood Drive, Port Macquarie New South Wales 2444, Australia",
      PORT_MACQUARIE
    );
    expect(seen.kind).toBe("house");
    expect(seen.claimsHarford).toBe(false);
    expect(seen.needsReview).toBe(true);
  });

  it("does not question a customer just over a state border", () => {
    // Newark, Delaware: a real neighbour, well inside the radius.
    const seen = assessAddress("100 Main St, Newark, Delaware 19711", { lat: 39.6837, lng: -75.7497 });
    expect(seen.needsReview).toBe(false);
  });

  it("does not question a Baltimore County address the business really works", () => {
    const seen = assessAddress("11824 Harford Road, Glen Arm, Maryland 21057", {
      lat: 39.4626,
      lng: -76.4783,
    });
    expect(seen.needsReview).toBe(false);
  });

  it("does not flag a Harford address that has no pin at all", () => {
    // Nothing to disagree with. A missing pin is what the county import fixes.
    const seen = assessAddress("1550 Swearingen Drive, Bel Air, Maryland 21014", null);
    expect(seen.needsReview).toBe(false);
    expect(seen.metresFromHarford).toBeNull();
  });

  it("reports both faults at once when an address has two", () => {
    const seen = assessAddress("Red Pump Road, Bel Air, Maryland 21014", MILAN_MISSOURI);
    expect(seen.kind).toBe("street");
    expect(seen.reasons).toHaveLength(2);
  });
});

describe("canLinkAutomatically", () => {
  it("links a county parcel to the same address in the CRM", () => {
    expect(
      canLinkAutomatically(
        normalizeAddress("1550 Swearingen Drive, Bel Air, Maryland 21014, United States"),
        normalizeAddress("1550 SWEARINGEN DR BEL AIR MD 21014")
      )
    ).toBe(true);
  });

  it("refuses two houses on one street", () => {
    expect(
      canLinkAutomatically(
        normalizeAddress("3133 Strasbaugh Drive, Bel Air, MD 21015"),
        normalizeAddress("3135 Strasbaugh Drive, Bel Air, MD 21015")
      )
    ).toBe(false);
  });

  it("refuses a near miss, which is what the review queue is for", () => {
    expect(
      canLinkAutomatically(
        normalizeAddress("1550 Swearingen Dr, Bel Air, MD 21014"),
        normalizeAddress("1550 Swearingen Dr, Bel Air, MD")
      )
    ).toBe(false);
  });

  it("refuses to link to nothing", () => {
    expect(canLinkAutomatically("", "")).toBe(false);
    expect(canLinkAutomatically(null, "1550 SWEARINGEN DR")).toBe(false);
  });
});

describe("streetPrefix", () => {
  it("is the same for one house written in two countries", () => {
    // The fingerprint of a rewritten address.
    expect(streetPrefix("319 Crestwood Drive, Edgewood, Maryland 21040, United States")).toBe(
      streetPrefix("319 Crestwood Drive, Port Macquarie New South Wales 2444, Australia")
    );
  });

  it("differs for two houses on one street", () => {
    expect(streetPrefix("3133 Strasbaugh Drive, Bel Air, MD 21015")).not.toBe(
      streetPrefix("3135 Strasbaugh Drive, Bel Air, MD 21015")
    );
  });

  it("is empty for nothing", () => {
    expect(streetPrefix("")).toBe("");
  });
});

describe("NORMALIZER_VERSION", () => {
  it("is a whole number that can be compared and bumped", () => {
    expect(Number.isInteger(NORMALIZER_VERSION)).toBe(true);
    expect(NORMALIZER_VERSION).toBeGreaterThan(0);
  });
});

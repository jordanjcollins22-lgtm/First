import { describe, expect, it } from "vitest";

import {
  addressSimilarity,
  houseNumber,
  normalizeAddress,
  sameAddress,
} from "@/lib/address-normalize";

describe("normalizeAddress", () => {
  it("canonicalises a real CRM address", () => {
    expect(normalizeAddress("1550 Swearingen Drive, Bel Air, Maryland 21014, United States")).toBe(
      "1550 SWEARINGEN DR BEL AIR MD 21014"
    );
  });

  it("canonicalises the same house written the county's way", () => {
    expect(normalizeAddress("1550 SWEARINGEN DR, BEL AIR, MD 21014")).toBe(
      "1550 SWEARINGEN DR BEL AIR MD 21014"
    );
  });

  it("canonicalises a commercial address", () => {
    expect(normalizeAddress("801 Long Drive, Aberdeen, Maryland 21001, United States")).toBe(
      "801 LONG DR ABERDEEN MD 21001"
    );
  });

  it("is empty for nothing, rather than guessing", () => {
    // An empty key matches nothing; a guessed key matches the wrong house.
    expect(normalizeAddress("")).toBe("");
    expect(normalizeAddress(null)).toBe("");
    expect(normalizeAddress(undefined)).toBe("");
  });

  it.each([
    ["Boulevard", "1628 Eva Mar Boulevard", "1628 EVA MAR BLVD"],
    ["Court", "12 Tollgate Court", "12 TOLLGATE CT"],
    ["Lane", "9 Bel Air Lane", "9 BEL AIR LN"],
    ["Road", "44 Churchville Road", "44 CHURCHVILLE RD"],
    ["Street", "3 Main Street", "3 MAIN ST"],
    ["Circle", "7 Hickory Circle", "7 HICKORY CIR"],
    ["Terrace", "5 Oak Terrace", "5 OAK TER"],
    ["Parkway", "22 Plumtree Parkway", "22 PLUMTREE PKWY"],
  ])("abbreviates %s", (_label, input, expected) => {
    expect(normalizeAddress(input)).toBe(expected);
  });

  it("abbreviates compass directions", () => {
    expect(normalizeAddress("100 North Main Street")).toBe("100 N MAIN ST");
    expect(normalizeAddress("100 Southwest Plaza")).toBe("100 SW PLZ");
  });

  it("leaves the first word alone, because a street can be named North", () => {
    // "North St" is a street name, not a direction plus a suffix.
    expect(normalizeAddress("North Street, Bel Air MD")).toBe("NORTH ST BEL AIR MD");
  });

  it("keeps unit numbers, because two flats are two doors", () => {
    expect(normalizeAddress("12 Main St Apartment 4")).toBe("12 MAIN ST APT 4");
    expect(normalizeAddress("12 Main St #4")).toBe("12 MAIN ST UNIT 4");
    expect(normalizeAddress("12 Main St Suite 200")).toBe("12 MAIN ST STE 200");
  });

  it("does not merge two flats at one street address", () => {
    expect(sameAddress("12 Main St Apt 1", "12 Main St Apt 2")).toBe(false);
  });

  it("treats a ZIP+4 as its ZIP", () => {
    expect(normalizeAddress("1550 Swearingen Dr, Bel Air, MD 21014-1234")).toBe(
      "1550 SWEARINGEN DR BEL AIR MD 21014"
    );
  });

  it("shortens a spelled-out state", () => {
    expect(normalizeAddress("1 Main St, Bel Air, Maryland 21014")).toBe("1 MAIN ST BEL AIR MD 21014");
  });

  it("does not let Virginia eat West Virginia", () => {
    expect(normalizeAddress("1 Main St, Elkins, West Virginia 26241")).toBe(
      "1 MAIN ST ELKINS WV 26241"
    );
  });

  it.each(["USA", "United States", "United States of America"])("drops a trailing %s", (country) => {
    expect(normalizeAddress(`1 Main St, Bel Air, MD 21014, ${country}`)).toBe(
      "1 MAIN ST BEL AIR MD 21014"
    );
  });

  it("survives sloppy punctuation and spacing", () => {
    expect(normalizeAddress("  1628   eva mar blvd.,, bel air , md  21015 ")).toBe(
      "1628 EVA MAR BLVD BEL AIR MD 21015"
    );
  });

  it("keeps a hyphenated house number intact", () => {
    expect(normalizeAddress("12-14 Main St")).toBe("12-14 MAIN ST");
  });
});

describe("sameAddress", () => {
  it("matches the CRM spelling to the county spelling", () => {
    expect(
      sameAddress(
        "1550 Swearingen Drive, Bel Air, Maryland 21014, United States",
        "1550 SWEARINGEN DR BEL AIR MD 21014"
      )
    ).toBe(true);
  });

  it("refuses two houses on the same street", () => {
    expect(sameAddress("1628 Eva Mar Blvd", "1638 Eva Mar Blvd")).toBe(false);
  });

  it("is false when either side is empty, so nothing links to nothing", () => {
    expect(sameAddress("", "1 Main St")).toBe(false);
    expect(sameAddress(null, null)).toBe(false);
  });
});

describe("addressSimilarity", () => {
  it("is 1 for the same house written two ways", () => {
    expect(addressSimilarity("1 Main Street, Bel Air, MD", "1 MAIN ST BEL AIR MD")).toBe(1);
  });

  it("is high but not 1 when one side is missing its ZIP", () => {
    const score = addressSimilarity("1 Main St Bel Air MD 21014", "1 Main St Bel Air MD");
    expect(score).toBeGreaterThan(0.7);
    expect(score).toBeLessThan(1);
  });

  it("is high for two houses on one street, which is why it is not a decision", () => {
    // 1628 and 1638 share every word but the number. A score alone would
    // merge them; that is what the house-number check is for.
    expect(addressSimilarity("1628 Eva Mar Blvd", "1638 Eva Mar Blvd")).toBeGreaterThan(0.5);
  });

  it("is 0 against nothing", () => {
    expect(addressSimilarity("1 Main St", "")).toBe(0);
  });

  it("is low for unrelated addresses", () => {
    expect(addressSimilarity("1 Main St Bel Air MD", "99 Ocean Ave Miami FL")).toBeLessThan(0.2);
  });
});

describe("houseNumber", () => {
  it("reads the number off the front", () => {
    expect(houseNumber("1628 Eva Mar Blvd")).toBe("1628");
  });

  it("keeps a letter suffix, because 12A is not 12", () => {
    expect(houseNumber("12A Main St")).toBe("12A");
  });

  it("is null when the address does not start with a number", () => {
    expect(houseNumber("North Street, Bel Air MD")).toBeNull();
  });

  it("tells two houses on one street apart", () => {
    expect(houseNumber("1628 Eva Mar Blvd")).not.toBe(houseNumber("1638 Eva Mar Blvd"));
  });
});

describe("real addresses out of the CRM", () => {
  it("survives a town actually called Street", () => {
    // Street, MD 21154 is a real place in Harford County. The suffix table
    // abbreviates it, which looks odd and is harmless: both sides of a match
    // go through the same table, so the key still agrees with itself.
    expect(normalizeAddress("3610 Ady Road, Street, Maryland 21154, United States")).toBe(
      "3610 ADY RD ST MD 21154"
    );
    expect(sameAddress("3610 Ady Rd, Street, MD 21154", "3610 ADY ROAD STREET MD 21154")).toBe(true);
  });

  it("handles a multi-word town", () => {
    expect(
      normalizeAddress("1343 Lewis Lane, Havre de Grace, Maryland 21078, United States")
    ).toBe("1343 LEWIS LN HAVRE DE GRACE MD 21078");
  });

  it("abbreviates inside town names too, which is ugly and deliberate", () => {
    // "North Canton" is a town, not a direction and a street. Abbreviating it
    // anyway keeps the key independent of punctuation. See the note on the
    // module: both sides of a match go through this, so they still agree.
    expect(
      normalizeAddress("419 Linwood Avenue Southwest, North Canton, Ohio 44720, United States")
    ).toBe("419 LINWOOD AVE SW N CANTON OH 44720");
  });

  it("abbreviates inside street names too", () => {
    expect(
      normalizeAddress("1206 Old Mountain Road North, Joppa, Maryland 21085, United States")
    ).toBe("1206 OLD MTN RD N JOPPA MD 21085");
  });

  it("leaves a street type it does not know alone rather than guessing", () => {
    // "Garth" is a real Maryland street type and not in the USPS table.
    expect(
      normalizeAddress("2506 Laurel Valley Garth, Abingdon, Maryland 21009, United States")
    ).toContain("GARTH");
  });

  it("gives one address one key however it is punctuated", () => {
    // The property the aggression buys, and the only one that matters.
    const withCommas = normalizeAddress("1206 Old Mountain Road North, Joppa, Maryland 21085");
    const without = normalizeAddress("1206 Old Mountain Road North Joppa Maryland 21085");
    const abbreviated = normalizeAddress("1206 OLD MTN RD N JOPPA MD 21085");
    expect(withCommas).toBe(without);
    expect(withCommas).toBe(abbreviated);
  });

  it("keeps genuinely different Harford streets apart", () => {
    const keys = [
      "2506 Laurel Valley Garth, Abingdon, Maryland 21009",
      "1205 Bear Hollow Court, Forest Hill, Maryland 21050",
      "521 Green Valley Court, Abingdon, Maryland 21009",
      "1206 Old Mountain Road North, Joppa, Maryland 21085",
      "2610 Rocks Road, Forest Hill, Maryland 21050",
    ].map(normalizeAddress);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("collapses the duplicate rows the CRM already holds", () => {
    expect(
      sameAddress(
        "11824 Harford Road, Glen Arm, Maryland 21057, United States",
        "11824 Harford Road, Glen Arm, Maryland 21057, United States"
      )
    ).toBe(true);
  });

  it("matches the CRM's long form to a county-style short form", () => {
    expect(
      sameAddress(
        "1709 Pine Forest Ct, Bel Air, Maryland 21014, United States",
        "1709 PINE FOREST COURT BEL AIR MD 21014"
      )
    ).toBe(true);
  });

  it("gives a street with no house number no house number", () => {
    // "Emmorton Road, Edgewood" is a street, not a house. The backfill has to
    // be able to tell, because a street cannot be one canonical address.
    expect(houseNumber("Emmorton Road, Edgewood, Maryland 21040, United States")).toBeNull();
    expect(houseNumber("3610 Ady Road, Street, Maryland 21154")).toBe("3610");
  });

  it("does not treat two houses on one Harford street as one", () => {
    expect(
      sameAddress(
        "3133 Strasbaugh Drive, Bel Air, Maryland 21015, United States",
        "3135 Strasbaugh Drive, Bel Air, Maryland 21015, United States"
      )
    ).toBe(false);
  });
});

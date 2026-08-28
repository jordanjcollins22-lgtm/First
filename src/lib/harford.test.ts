import { describe, expect, it } from "vitest";

import { checkHarford, HARFORD_ZIPS, outOfArea } from "./harford";

describe("addresses that are clearly in the county", () => {
  it("accepts a Harford ZIP", () => {
    expect(checkHarford({ address: "123 Main St, Bel Air, MD 21014" })).toEqual({
      verdict: "inside",
      reason: "ZIP 21014",
    });
  });

  it("accepts a Harford town when there is no ZIP", () => {
    expect(checkHarford({ address: "12 Elm Street, Havre de Grace, MD" }).verdict).toBe("inside");
  });

  it("covers the towns people actually live in", () => {
    for (const town of ["Aberdeen", "Abingdon", "Fallston", "Forest Hill", "Joppa", "Edgewood"]) {
      expect(checkHarford({ address: `1 Some Road, ${town}, MD` }).verdict, town).toBe("inside");
    }
  });
});

describe("addresses that are clearly not", () => {
  it("flags another Maryland county by its ZIP", () => {
    // Towson is Baltimore County. This is the common case: a real customer,
    // but not one this list should be counting as local.
    const check = checkHarford({ address: "9 Joppa Road, Towson, MD 21204" });
    expect(check.verdict).toBe("outside");
    expect(check.reason).toContain("21204");
  });

  it("flags another state by its ZIP", () => {
    expect(checkHarford({ address: "500 Broadway, New York, NY 10012" }).verdict).toBe("outside");
  });

  it("flags a named state that is not Maryland", () => {
    const check = checkHarford({ address: "14 Oak Lane, Dover, DE" });
    expect(check.verdict).toBe("outside");
    expect(check.reason).toContain("DE");
  });

  it("flags a map location nowhere near the county", () => {
    // A geocoder that guessed. The address text can look perfectly local.
    const check = checkHarford({ address: "100 Main Street", lat: 34.05, lng: -118.24 });
    expect(check.verdict).toBe("outside");
    expect(check.reason).toContain("outside the county");
  });

  it("trusts the ZIP over a town name that exists in forty states", () => {
    // "Street" is a real Harford town, which is exactly why the ZIP has to win.
    expect(checkHarford({ address: "8 Street Road, Street, PA 19014" }).verdict).toBe("outside");
  });
});

describe("addresses it will not guess about", () => {
  it("says nothing about an empty address", () => {
    expect(checkHarford({ address: "" }).verdict).toBe("unknown");
    expect(checkHarford({ address: "   " }).verdict).toBe("unknown");
  });

  it("does not flag a lead just because nobody geocoded it", () => {
    // Null island is what an un-geocoded row looks like. Calling that
    // "outside the county" puts every un-geocoded lead on the list.
    expect(checkHarford({ address: "42 Unknown Road", lat: 0, lng: 0 }).verdict).toBe("unknown");
    expect(checkHarford({ address: "42 Unknown Road", lat: null, lng: null }).verdict).toBe(
      "unknown"
    );
  });

  it("does not claim inside from the bounding box alone", () => {
    // The box overlaps Baltimore and Cecil counties, so a point inside it is
    // not an answer. Claiming otherwise would hide real bad addresses.
    const check = checkHarford({ address: "5 Ridge Road", lat: 39.45, lng: -76.5 });
    expect(check.verdict).toBe("unknown");
    expect(check.reason).toContain("no ZIP or town");
  });

  it("does not read Maryland's own MD as another state", () => {
    expect(checkHarford({ address: "3 Cherry Lane, Bel Air, MD" }).verdict).toBe("inside");
  });
});

describe("outOfArea", () => {
  const rows = [
    { id: "a", address: "1 Main St, Bel Air, MD 21014" },
    { id: "b", address: "2 High St, Towson, MD 21204" },
    { id: "c", address: "3 Nowhere Rd" },
    { id: "d", address: "4 Beach Rd, Miami, FL 33101" },
  ];

  it("returns only the ones worth checking", () => {
    // Not the unknowns. A list of two hundred fine addresses is a list
    // nobody opens.
    expect(outOfArea(rows).map((r) => r.id)).toEqual(["b", "d"]);
  });

  it("says why each one was flagged", () => {
    for (const row of outOfArea(rows)) {
      expect(row.reason.length).toBeGreaterThan(0);
    }
  });

  it("keeps the original row intact", () => {
    expect(outOfArea(rows)[0].address).toBe("2 High St, Towson, MD 21204");
  });

  it("is empty when everything is local", () => {
    expect(outOfArea([{ id: "a", address: "1 Main St, Bel Air, MD 21014" }])).toEqual([]);
  });
});

describe("the ZIP list", () => {
  it("holds the county's real ZIPs", () => {
    for (const zip of ["21014", "21015", "21001", "21078", "21040", "21085", "21050"]) {
      expect(HARFORD_ZIPS.has(zip), zip).toBe(true);
    }
  });

  it("does not hold a neighbouring county's", () => {
    for (const zip of ["21204", "21286", "21901", "21093"]) {
      expect(HARFORD_ZIPS.has(zip), zip).toBe(false);
    }
  });
});

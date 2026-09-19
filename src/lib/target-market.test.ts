import { describe, expect, it } from "vitest";

import { describeTally, marketFor, tallyMarkets, type TargetMarket } from "@/lib/target-market";

const HARFORD: TargetMarket = {
  id: "m1",
  name: "Harford County, MD",
  zips: ["21014", "21015", "21050", "21154"],
  cities: ["Bel Air", "Forest Hill", "Street", "Havre de Grace"],
  counties: ["Harford"],
  active: true,
};

describe("marketFor", () => {
  it("matches on zip, which is the only exact one", () => {
    const verdict = marketFor({ address: "208 Crafton Rd", city: null, zip: "21014" }, [HARFORD]);
    expect(verdict).toMatchObject({ known: true, inMarket: true, matchedOn: "zip" });
  });

  it("matches a ZIP+4 against a plain zip", () => {
    expect(marketFor({ address: null, city: null, zip: "21014-1234" }, [HARFORD])).toMatchObject({
      inMarket: true,
    });
  });

  it("finds the zip inside a one-line address", () => {
    // Imports routinely leave the city and zip columns blank and put the lot
    // on one line.
    const verdict = marketFor(
      { address: "208 Crafton Rd, Bel Air, MD 21014", city: null, zip: null },
      [HARFORD]
    );
    expect(verdict).toMatchObject({ inMarket: true, matchedOn: "zip" });
  });

  it("matches on town when there is no zip", () => {
    expect(marketFor({ address: null, city: "Bel Air", zip: null }, [HARFORD])).toMatchObject({
      inMarket: true,
      matchedOn: "city",
    });
  });

  it("does not match a town name that is merely a word in the address", () => {
    // "Street" is a town in Harford County and a word in every address ever
    // written. Substring matching would put all of Baltimore in our market.
    const verdict = marketFor({ address: "14 Main Street, Baltimore, MD 21201", city: null, zip: null }, [
      HARFORD,
    ]);
    expect(verdict).toEqual({ known: true, inMarket: false });
  });

  it("still matches the town when it stands on its own", () => {
    expect(
      marketFor({ address: "1 Post Rd, Street, MD 21154", city: null, zip: null }, [HARFORD])
    ).toMatchObject({ inMarket: true });
  });

  it("falls back to the county name where an address carries one", () => {
    const verdict = marketFor({ address: "9 Lane, Harford County, MD", city: null, zip: null }, [HARFORD]);
    expect(verdict).toMatchObject({ inMarket: true, matchedOn: "county" });
  });

  it("says out of market when there was something to go on and none of it matched", () => {
    expect(marketFor({ address: "1 Elm St, Wilmington, DE 19801", city: null, zip: null }, [HARFORD])).toEqual({
      known: true,
      inMarket: false,
    });
  });

  it("says nothing rather than out of market when the address is blank", () => {
    // Marking somebody outside our area because their address was empty is
    // the mistake that quietly takes a whole import out of the calling list.
    expect(marketFor({ address: null, city: null, zip: null }, [HARFORD])).toEqual({ known: false });
    expect(marketFor({ address: "  ", city: "", zip: "" }, [HARFORD])).toEqual({ known: false });
  });

  it("treats everywhere as our market when none is configured", () => {
    // The alternative is an app that declares every contact out of area on
    // the day it is installed.
    expect(marketFor({ address: "1 Elm St, Wilmington, DE", city: null, zip: null }, [])).toEqual({
      known: false,
    });
  });

  it("ignores a market somebody has switched off", () => {
    const off = [{ ...HARFORD, active: false }];
    expect(marketFor({ address: null, city: null, zip: "21014" }, off)).toEqual({ known: false });
  });

  it("names which market matched, since there can be more than one", () => {
    const cecil: TargetMarket = {
      id: "m2",
      name: "Cecil County, MD",
      zips: ["21921"],
      cities: [],
      counties: [],
      active: true,
    };
    const verdict = marketFor({ address: null, city: null, zip: "21921" }, [HARFORD, cecil]);
    expect(verdict).toMatchObject({ inMarket: true, market: { name: "Cecil County, MD" } });
  });
});

describe("tallyMarkets", () => {
  it("counts the three answers separately", () => {
    const tally = tallyMarkets(
      [
        { address: null, city: null, zip: "21014" },
        { address: "1 Elm St, Wilmington, DE 19801", city: null, zip: null },
        { address: null, city: null, zip: null },
      ],
      [HARFORD]
    );
    expect(tally).toEqual({ inMarket: 1, outOfMarket: 1, unknown: 1 });
  });
});

describe("describeTally", () => {
  it("frames out of market as an opportunity, not a cull", () => {
    // The difference between calling them and deleting them.
    const text = describeTally({ inMarket: 10, outOfMarket: 4, unknown: 0 });
    expect(text).toContain("worth a call");
  });

  it("says so plainly when everything is inside", () => {
    expect(describeTally({ inMarket: 10, outOfMarket: 0, unknown: 2 })).toContain("inside our market");
  });

  it("does not claim anything before anything has been checked", () => {
    expect(describeTally({ inMarket: 0, outOfMarket: 0, unknown: 5 })).toContain("Nothing has been checked");
  });
});

import { describe, expect, it } from "vitest";

import { looserTerms, rankHits, searchTerms } from "@/lib/address-search";

describe("searchTerms", () => {
  it("normalizes each word so it matches the key", () => {
    expect(searchTerms("128 Post Road Aberdeen")).toEqual(["128", "POST", "RD", "ABERDEEN"]);
  });

  it("puts back a space that went missing between two words", () => {
    // "128 Post RdAberdeen, MD 21001", exactly as it was typed the day the
    // search could not find 128 N Post Rd.
    expect(searchTerms("128 Post RdAberdeen, MD 21001")).toEqual(["128", "POST", "RD", "ABERDEEN", "MD", "21001"]);
  });

  it("drops repeats and empties", () => {
    expect(searchTerms("  main   main st ")).toEqual(["MAIN", "ST"]);
    expect(searchTerms("")).toEqual([]);
  });
});

describe("looserTerms", () => {
  it("falls back to the number and the street name", () => {
    expect(looserTerms(["128", "POST", "RD", "ABERDEEN", "MD", "21001"])).toEqual(["128", "ABERDEEN"]);
  });

  it("has nothing to loosen for a short search", () => {
    expect(looserTerms(["128", "POST"])).toEqual([]);
  });
});

describe("rankHits", () => {
  it("floats the typed house number's street to the top", () => {
    const hits = [{ normalized: "1128 POST RD ABERDEEN MD 21001" }, { normalized: "128 N POST RD ABERDEEN MD 21001" }];
    expect(rankHits(hits, ["128", "POST"]).map((h) => h.normalized)).toEqual([
      "128 N POST RD ABERDEEN MD 21001",
      "1128 POST RD ABERDEEN MD 21001",
    ]);
  });
});

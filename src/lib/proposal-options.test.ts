import { describe, expect, it } from "vitest";

import { applyOption, readOptions } from "@/lib/proposal-options";

const option = (key: string, totalCents: number, prices: number[]) => ({
  key,
  name: key,
  tagline: "",
  totalCents,
  includes: ["Aeration"],
  notIncluded: [],
  areas: prices.map((priceCents) => ({ priceCents, lines: [{ key: "aeration", quantity: 1, materialCents: 0 }] })),
});

describe("options on a proposal", () => {
  it("reads two options that cover every area", () => {
    const read = readOptions({ options: [option("essential", 500, [200, 300]), option("full", 900, [400, 500])] }, 2);
    expect(read?.options.map((o) => o.key)).toEqual(["essential", "full"]);
    expect(read?.chosen).toBeNull();
  });

  it("treats anything malformed as a single price", () => {
    expect(readOptions(null, 2)).toBeNull();
    expect(readOptions({ options: [option("essential", 500, [200, 300])] }, 2)).toBeNull();
    // An option missing an area would leave that area unpriced.
    expect(readOptions({ options: [option("a", 500, [200]), option("b", 900, [400, 500])] }, 2)).toBeNull();
    expect(readOptions({ options: [option("a", 500, [200, 300]), option("a", 900, [400, 500])] }, 2)).toBeNull();
  });

  it("only keeps a choice that is one of the options", () => {
    expect(readOptions({ options: [option("a", 1, [1]), option("b", 2, [2])], chosen: "b" }, 1)?.chosen).toBe("b");
    expect(readOptions({ options: [option("a", 1, [1]), option("b", 2, [2])], chosen: "z" }, 1)?.chosen).toBeNull();
  });

  it("gives the proposal the chosen option's price and areas, keeping their wording", () => {
    const snapshot = [{ zoneName: "Lawn", scopeText: "Aerate", priceCents: 1, lines: [] }];
    const done = applyOption(snapshot, option("full", 90000, [90000]));
    expect(done.totalCost).toBe(900);
    expect(done.snapshot[0]).toMatchObject({ zoneName: "Lawn", scopeText: "Aerate", priceCents: 90000, priceDerived: true });
    expect(done.snapshot[0].lines).toHaveLength(1);
  });
});

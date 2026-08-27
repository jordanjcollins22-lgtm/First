import { describe, expect, it } from "vitest";

import {
  availableResolutions,
  canReduceScope,
  objectionById,
  OBJECTIONS,
  reduceScope,
  shouldOfferOther,
  type ScopeLine,
} from "./objections";

function line(over: Partial<ScopeLine> & { zoneName: string }): ScopeLine {
  return {
    serviceLabel: "Mulch",
    priceCents: 50_000,
    priceDerived: true,
    ...over,
  };
}

describe("the catalogue", () => {
  it("gives every objection an answer", () => {
    for (const o of OBJECTIONS) {
      expect(o.answer.trim().length).toBeGreaterThan(40);
      expect(o.label.trim()).not.toBe("");
      expect(o.resolutions.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate ids", () => {
    const ids = OBJECTIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers a payment plan wherever money is the problem", () => {
    for (const id of ["price_high", "cannot_pay_at_once"]) {
      expect(objectionById(id)!.resolutions).toContain("payment_plan");
    }
  });

  it("finds by id and returns nothing for a stranger", () => {
    expect(objectionById("price_high")?.id).toBe("price_high");
    expect(objectionById("nope")).toBeUndefined();
  });
});

describe("shouldOfferOther", () => {
  it("stays hidden until an answer has been rejected", () => {
    expect(shouldOfferOther({ rejected: [] })).toBe(false);
  });

  it("appears once we have failed to solve something", () => {
    expect(shouldOfferOther({ rejected: ["price_high"] })).toBe(true);
  });
});

describe("canReduceScope", () => {
  it("is false for a single-area proposal", () => {
    expect(canReduceScope([line({ zoneName: "Front bed" })])).toBe(false);
  });

  it("is true once there is something to drop", () => {
    expect(canReduceScope([line({ zoneName: "a" }), line({ zoneName: "b" })])).toBe(true);
  });
});

describe("availableResolutions", () => {
  it("drops the trim option when there is nothing to trim", () => {
    const objection = objectionById("price_high")!;
    const one = availableResolutions(objection, [line({ zoneName: "only" })]);
    expect(one).not.toContain("reduce_scope");
    expect(one).toContain("payment_plan");
  });

  it("keeps it when there are several areas", () => {
    const objection = objectionById("price_high")!;
    const many = availableResolutions(objection, [line({ zoneName: "a" }), line({ zoneName: "b" })]);
    expect(many).toContain("reduce_scope");
  });
});

describe("reduceScope", () => {
  const lines = [
    line({ zoneName: "Front bed", priceCents: 120_000 }),
    line({ zoneName: "Back fence", priceCents: 80_000 }),
    line({ zoneName: "Side path", priceCents: 45_000 }),
  ];

  it("re-prices to the kept areas when every price came off the rate card", () => {
    const change = reduceScope(lines, ["Front bed", "Side path"]);
    expect(change.auto).toBe(true);
    expect(change.newTotalCents).toBe(165_000);
    expect(change.droppedCents).toBe(80_000);
    expect(change.droppedNames).toEqual(["Back fence"]);
    expect(change.reviewReason).toBeNull();
  });

  it("kept plus dropped is always the whole quote", () => {
    const change = reduceScope(lines, ["Back fence"]);
    expect(change.newTotalCents! + change.droppedCents).toBe(245_000);
  });

  it("sends it for review when a price was entered by hand", () => {
    const handed = [
      lines[0],
      line({ zoneName: "Back fence", priceCents: 80_000, priceDerived: false }),
      lines[2],
    ];
    const change = reduceScope(handed, ["Front bed"]);
    expect(change.auto).toBe(false);
    expect(change.newTotalCents).toBeNull();
    expect(change.reviewReason).toMatch(/by hand/);
  });

  it("sends it for review when a line has no price at all", () => {
    const partial = [lines[0], line({ zoneName: "Back fence", priceCents: null }), lines[2]];
    const change = reduceScope(partial, ["Front bed"]);
    expect(change.auto).toBe(false);
    expect(change.newTotalCents).toBeNull();
  });

  it("sends it for review when a discount was agreed on the whole job", () => {
    const change = reduceScope(lines, ["Front bed"], { discountCents: 10_000 });
    expect(change.auto).toBe(false);
    expect(change.reviewReason).toMatch(/discount/);
  });

  it("refuses to empty the quote", () => {
    const change = reduceScope(lines, []);
    expect(change.auto).toBe(false);
    expect(change.newTotalCents).toBeNull();
    expect(change.reviewReason).toMatch(/at least one/);
  });

  it("does nothing when nothing was dropped", () => {
    const change = reduceScope(lines, lines.map((l) => l.zoneName), { statedTotalCents: 245_000 });
    expect(change.droppedNames).toEqual([]);
    expect(change.auto).toBe(false);
    expect(change.newTotalCents).toBe(245_000);
  });

  it("ignores a name that is not on the quote rather than inventing a line", () => {
    const change = reduceScope(lines, ["Front bed", "A patio nobody quoted"]);
    expect(change.keptNames).toEqual(["Front bed"]);
    expect(change.newTotalCents).toBe(120_000);
  });

  it("never returns a total when it is not applying one", () => {
    const handed = [lines[0], line({ zoneName: "Back fence", priceDerived: false })];
    const change = reduceScope(handed, ["Front bed"]);
    expect(change.auto).toBe(false);
    expect(change.newTotalCents).toBeNull();
  });
});

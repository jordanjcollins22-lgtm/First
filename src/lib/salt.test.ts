import { describe, expect, it } from "vitest";

import {
  buyingList,
  DEFAULT_SALT_SETTINGS,
  isSurface,
  MINIMUM_TREATMENTS,
  minutesFor,
  money,
  poundsFor,
  priceTreatment,
  quoteOrder,
  type SaltSettings,
} from "@/lib/salt";

describe("priceTreatment", () => {
  it("prices a sidewalk round at something a person would recognise", () => {
    const price = priceTreatment("sidewalks", false);
    expect(price.priceCents % 500).toBe(0);
    expect(price.priceCents).toBeGreaterThan(1_500);
    expect(price.priceCents).toBeLessThan(6_000);
  });

  it("charges more for a driveway than for sidewalks alone", () => {
    expect(priceTreatment("driveway", false).priceCents).toBeGreaterThan(
      priceTreatment("sidewalks", false).priceCents
    );
  });

  it("prices both for less than the two bought separately", () => {
    // One trip covers both, so charging the stop twice would be charging for
    // a drive that only happened once.
    const both = priceTreatment("both", false).priceCents;
    const apart =
      priceTreatment("sidewalks", false).priceCents + priceTreatment("driveway", false).priceCents;
    expect(both).toBeLessThan(apart);
  });

  it("is mostly time rather than product", () => {
    // The whole shape of this service: a pound of calcium chloride is under
    // two dollars and somebody still had to drive there at five in the
    // morning. Pricing it on the bag would price it at nearly nothing.
    const price = priceTreatment("sidewalks", false);
    expect(price.materialCents).toBeLessThan(price.labourCents / 3);
  });

  it("costs a little more pet safe, not a lot", () => {
    const plain = priceTreatment("sidewalks", false);
    const pet = priceTreatment("sidewalks", true);
    expect(pet.materialCents).toBeGreaterThan(plain.materialCents);
    expect(pet.priceCents).toBeGreaterThanOrEqual(plain.priceCents);
  });

  it("moves when the bag price does", () => {
    const dear: SaltSettings = { ...DEFAULT_SALT_SETTINGS, bagCostCents: 9_000 };
    expect(priceTreatment("driveway", false, dear).materialCents).toBeGreaterThan(
      priceTreatment("driveway", false).materialCents
    );
  });

  it("never quotes nothing, however cheap the inputs get", () => {
    const free: SaltSettings = {
      ...DEFAULT_SALT_SETTINGS,
      bagCostCents: 0,
      crewCostPerHourCents: 0,
      overheadPerCrewHourCents: 0,
    };
    expect(priceTreatment("sidewalks", false, free).priceCents).toBeGreaterThan(0);
  });

  it("does not divide by an empty bag", () => {
    const broken: SaltSettings = { ...DEFAULT_SALT_SETTINGS, bagPounds: 0 };
    expect(Number.isFinite(priceTreatment("sidewalks", false, broken).priceCents)).toBe(true);
  });
});

describe("quoteOrder", () => {
  it("multiplies the treatment price by the treatments", () => {
    const quote = quoteOrder({ surface: "sidewalks", petFriendly: false, treatments: 5 });
    expect(quote.totalCents).toBe(quote.perTreatmentCents * 5);
  });

  it("holds the floor rather than refusing a small number", () => {
    // A form that rejects a number is a form somebody abandons.
    const quote = quoteOrder({ surface: "sidewalks", petFriendly: false, treatments: 1 });
    expect(quote.treatments).toBe(MINIMUM_TREATMENTS);
  });

  it("caps a fat finger", () => {
    expect(quoteOrder({ surface: "both", petFriendly: false, treatments: 900 }).treatments).toBe(40);
  });

  it("copes with a treatments box somebody emptied", () => {
    const quote = quoteOrder({
      surface: "both",
      petFriendly: false,
      treatments: Number.NaN,
    });
    expect(quote.treatments).toBe(MINIMUM_TREATMENTS);
    expect(quote.totalCents).toBeGreaterThan(0);
  });

  it("says how much product the order will take", () => {
    const quote = quoteOrder({ surface: "sidewalks", petFriendly: false, treatments: 3 });
    expect(quote.pounds).toBe(poundsFor("sidewalks", DEFAULT_SALT_SETTINGS) * 3);
  });
});

describe("minutesFor", () => {
  it("makes a driveway alone carry the trip too", () => {
    // Somebody still has to get there. Only doing both shares the drive.
    expect(minutesFor("driveway", DEFAULT_SALT_SETTINGS)).toBeGreaterThan(
      DEFAULT_SALT_SETTINGS.drivewayMinutes
    );
    expect(minutesFor("both", DEFAULT_SALT_SETTINGS)).toBeGreaterThan(
      minutesFor("driveway", DEFAULT_SALT_SETTINGS)
    );
  });
});

describe("buyingList", () => {
  const orders = [
    { surface: "sidewalks" as const, petFriendly: false, treatments: 3, used: 0 },
    { surface: "both" as const, petFriendly: false, treatments: 5, used: 2 },
    { surface: "driveway" as const, petFriendly: true, treatments: 4, used: 0 },
  ];

  it("counts what is still owed, not what was sold", () => {
    // A season half delivered should not keep asking for product already
    // spread.
    const list = buyingList(orders);
    expect(list.outstanding).toBe(3 + 3 + 4);
  });

  it("keeps the pet safe bags apart from the ordinary ones", () => {
    // A different bag at a different price that cannot be substituted. One
    // figure would send somebody to the supplier with the wrong basket.
    const list = buyingList(orders);
    expect(list.petPounds).toBe(5 * 4);
    expect(list.standardPounds).toBe(2 * 3 + 7 * 3);
  });

  it("rounds bags up, because half a bag is not orderable", () => {
    const list = buyingList([
      { surface: "sidewalks", petFriendly: false, treatments: 3, used: 0 },
    ]);
    expect(list.standardPounds).toBe(6);
    expect(list.standardBags).toBe(1);
  });

  it("prices the basket from what the bags cost", () => {
    const list = buyingList(orders);
    expect(list.standardCostCents).toBe(list.standardBags * DEFAULT_SALT_SETTINGS.bagCostCents);
    expect(list.totalCostCents).toBe(list.standardCostCents + list.petCostCents);
  });

  it("asks for nothing when everything sold has been delivered", () => {
    const list = buyingList([
      { surface: "both", petFriendly: false, treatments: 3, used: 3 },
    ]);
    expect(list.outstanding).toBe(0);
    expect(list.totalCostCents).toBe(0);
  });

  it("ignores a used count that overran its order", () => {
    const list = buyingList([
      { surface: "both", petFriendly: false, treatments: 3, used: 9 },
    ]);
    expect(list.outstanding).toBe(0);
  });

  it("has nothing to buy for nobody", () => {
    expect(buyingList([]).totalCostCents).toBe(0);
  });
});

describe("isSurface", () => {
  it("takes the three real ones and nothing else", () => {
    expect(isSurface("sidewalks")).toBe(true);
    expect(isSurface("both")).toBe(true);
    expect(isSurface("roof")).toBe(false);
    expect(isSurface(null)).toBe(false);
  });
});

describe("money", () => {
  it("drops the cents on a round number", () => {
    expect(money(9_000)).toBe("$90");
    expect(money(9_050)).toBe("$90.50");
  });
});

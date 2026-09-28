import { describe, expect, it } from "vitest";

import { costSalting, saltingMaterial, saltingOrder, saltingScope } from "./salting";
import { quoteOrder } from "./salt";

describe("salting off the site map", () => {
  it("costs exactly what the salt page charges for the same order", () => {
    const values = { surface: "Driveway and walkways", treatments: "3", petSafe: "No" };
    const cost = costSalting(values);
    expect(cost.priceCents).toBe(quoteOrder({ surface: "both", petFriendly: false, treatments: 3 }).totalCents);
    expect(cost.priceCents).toBe(15_000);
    expect(cost.materialsCents + cost.labourCents).toBeLessThan(cost.priceCents);
  });

  it("holds the order to three treatments", () => {
    expect(saltingOrder({ treatments: "1" }).treatments).toBe(3);
    expect(saltingOrder({}).treatments).toBe(3);
    expect(saltingOrder({ treatments: "6" }).treatments).toBe(6);
  });

  it("names the salt to buy ahead for every treatment sold", () => {
    const salt = saltingMaterial({ surface: "Driveway", treatments: "4", petSafe: "Yes" });
    expect(salt.name).toBe("Calcium chloride, pet safe blend");
    expect(salt.pounds).toBe(20);
    expect(salt.bags).toBe(1);
  });

  it("tells the client the minimum and that it is paid up front", () => {
    const text = saltingScope({ surface: "Sidewalks and walkways", treatments: "3" });
    expect(text).toMatch(/3 treatments at \$25 each, \$75 in all, on the sidewalks and walkways/);
    expect(text).toMatch(/Three treatments is the minimum to book/);
    expect(text).toMatch(/paid up front/);
  });
});

import { describe, expect, it } from "vitest";

import { marylandFirst, plainAddress } from "@/lib/mapbox-geocoding";

const at = (fullAddress: string) => ({ id: fullAddress, fullAddress, lat: 0, lng: 0 });

describe("addresses as a client types their own", () => {
  it("drops the country", () => {
    expect(plainAddress("2900 Lomond Place, Abingdon, Maryland 21009, United States")).toBe("2900 Lomond Place, Abingdon, Maryland 21009");
  });
  it("shows only Maryland when there is any Maryland", () => {
    const found = marylandFirst([
      at("2900 Lomond Place, Abingdon, Maryland 21009, United States"),
      at("2900 Lemond Road, Owatonna, Minnesota 55060, United States"),
    ]);
    expect(found.map((s) => s.fullAddress)).toEqual(["2900 Lomond Place, Abingdon, Maryland 21009"]);
  });
  it("keeps the rest when nothing is in Maryland", () => {
    expect(marylandFirst([at("1 Main Street, Dover, Delaware 19901, United States")])).toHaveLength(1);
  });
});

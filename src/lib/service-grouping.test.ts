import { describe, expect, it } from "vitest";
import { groupByService, groupHeading, worthGrouping } from "./service-grouping";

const zone = (serviceLabel: string, zoneName = serviceLabel) => ({ serviceLabel, zoneName });

describe("groupByService", () => {
  it("gathers every area of one service under it", () => {
    // Six lawn areas is one job in six places, not six jobs.
    const groups = groupByService([
      zone("Lawn Care", "Front lawn"),
      zone("Lawn Care", "Side strip"),
      zone("Mulching", "Front beds"),
      zone("Lawn Care", "Back lawn"),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].service).toBe("Lawn Care");
    expect(groups[0].zones.map((z) => z.zoneName)).toEqual([
      "Front lawn",
      "Side strip",
      "Back lawn",
    ]);
    expect(groups[1].service).toBe("Mulching");
  });

  it("keeps each zone's original number", () => {
    // The number is what somebody points at across a garden. Renumbering per
    // group would make the same patch of grass zone 2 here and zone 4 on the
    // map.
    const groups = groupByService([
      zone("Lawn Care", "Front"),
      zone("Mulching", "Beds"),
      zone("Lawn Care", "Back"),
    ]);
    expect(groups[0].positions).toEqual([1, 3]);
    expect(groups[1].positions).toEqual([2]);
  });

  it("orders groups by where each one first appears", () => {
    // The sheet should still run front of property to back, not alphabetical.
    const groups = groupByService([zone("Mulching"), zone("Lawn Care"), zone("Mulching")]);
    expect(groups.map((g) => g.service)).toEqual(["Mulching", "Lawn Care"]);
  });

  it("treats the same service typed two ways as one", () => {
    const groups = groupByService([zone("Lawn Care"), zone("lawn care"), zone(" Lawn Care ")]);
    expect(groups).toHaveLength(1);
    // Shown as the spelling somebody actually used first.
    expect(groups[0].service).toBe("Lawn Care");
  });

  it("gives an unlabelled zone somewhere to go rather than dropping it", () => {
    const groups = groupByService([zone("")]);
    expect(groups[0].service).toBe("Other work");
    expect(groups[0].zones).toHaveLength(1);
  });

  it("has an answer for a proposal with no zones", () => {
    expect(groupByService([])).toEqual([]);
  });
});

describe("groupHeading", () => {
  it("says how many places a service covers", () => {
    const [group] = groupByService([zone("Lawn Care"), zone("Lawn Care")]);
    expect(groupHeading(group)).toBe("Lawn Care · 2 areas");
  });

  it("does not count a service with one area", () => {
    // "Lawn Care, 1 area" is a sentence about nothing.
    const [group] = groupByService([zone("Lawn Care")]);
    expect(groupHeading(group)).toBe("Lawn Care");
  });
});

describe("worthGrouping", () => {
  it("is true once any service covers more than one area", () => {
    expect(worthGrouping(groupByService([zone("Lawn Care"), zone("Lawn Care")]))).toBe(true);
  });

  it("is false when every service has one area", () => {
    // Grouping there is the same list with extra headings on it.
    expect(worthGrouping(groupByService([zone("Lawn Care"), zone("Mulching")]))).toBe(false);
  });
});

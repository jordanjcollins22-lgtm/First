import { describe, expect, it } from "vitest";

import {
  WEED_GROUPS,
  WEED_SEED,
  bookingPath,
  columnsFor,
  groupWeeds,
  rowsOf,
  isSheetView,
  showsBookingOffer,
  weedScanPath,
  weedsFor,
  type WeedGroup,
} from "./weeds";

describe("the weed list", () => {
  it("names every weed once", () => {
    const slugs = WEED_SEED.map((w) => w.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("puts every weed in a group that prints", () => {
    for (const weed of WEED_SEED) expect(WEED_GROUPS).toContain(weed.group);
  });

  it("gives the client a subset of what the crew carries", () => {
    const client = WEED_SEED.filter((w) => w.client);
    expect(client.length).toBeGreaterThan(0);
    expect(client.length).toBeLessThan(WEED_SEED.length);
  });

  it("has a scientific name for every one, so the crew sheet is not half blank", () => {
    for (const weed of WEED_SEED) expect(weed.scientific.trim()).not.toBe("");
  });
});

describe("what goes on a sheet", () => {
  const weeds = [
    { slug: "a", group: "Grassy weeds" as WeedGroup, client: true },
    { slug: "b", group: "Broadleaf perennials" as WeedGroup, client: false },
    { slug: "c", group: "Grassy weeds" as WeedGroup, client: true },
  ];

  it("gives the client only their own", () => {
    expect(weedsFor(weeds, "client").map((w) => w.slug)).toEqual(["a", "c"]);
  });

  it("gives the crew everything", () => {
    expect(weedsFor(weeds, "crew")).toHaveLength(3);
  });

  it("does not hand back the array it was given", () => {
    expect(weedsFor(weeds, "crew")).not.toBe(weeds);
  });

  it("orders the groups the way they print and drops the empty ones", () => {
    const blocks = groupWeeds(weeds);
    expect(blocks.map((b) => b.group)).toEqual(["Broadleaf perennials", "Grassy weeds"]);
    expect(blocks[1].weeds.map((w) => w.slug)).toEqual(["a", "c"]);
  });

  it("prints the client's bigger and the crew's tighter", () => {
    expect(columnsFor("client")).toBeLessThan(columnsFor("crew"));
  });
});

describe("the view in a link", () => {
  it("takes the two it knows", () => {
    expect(isSheetView("client")).toBe(true);
    expect(isSheetView("crew")).toBe(true);
  });

  it("refuses anything else, so a typed URL cannot print a third thing", () => {
    expect(isSheetView("both")).toBe(false);
    expect(isSheetView(null)).toBe(false);
    expect(isSheetView(undefined)).toBe(false);
  });
});

describe("where a scan lands", () => {
  it("is short, and relative to whatever domain served the sheet", () => {
    expect(weedScanPath("K7M2QP")).toBe("/w/K7M2QP");
  });
});

describe("the offer at the end of the client's sheet", () => {
  it("is on the client's sheet and nowhere else", () => {
    // A crew knows the root rule, and is not booking its own company.
    expect(showsBookingOffer("client")).toBe(true);
    expect(showsBookingOffer("crew")).toBe(false);
  });

  it("carries the business through, so the booking lands on the right one", () => {
    expect(bookingPath("js-landscaping-md-00000000")).toBe("/book?org=js-landscaping-md-00000000");
  });

  it("still points somewhere when no slug has been minted yet", () => {
    // A code that goes to the plain booking page beats no code at all.
    expect(bookingPath(null)).toBe("/book");
    expect(bookingPath(undefined)).toBe("/book");
    expect(bookingPath("")).toBe("/book");
  });
});

describe("cutting a group into rows", () => {
  const five = ["a", "b", "c", "d", "e"];

  it("fills each row before starting the next", () => {
    expect(rowsOf(five, 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("leaves the last row short rather than padding it out", () => {
    // A short last row keeps its columns; stretching two cells across five
    // would make the tail of a group look like a different sheet.
    expect(rowsOf(five, 5)).toEqual([five]);
    expect(rowsOf(five, 4)).toEqual([["a", "b", "c", "d"], ["e"]]);
  });

  it("gives back nothing for no weeds", () => {
    expect(rowsOf([], 5)).toEqual([]);
  });

  it("keeps every weed exactly once", () => {
    for (const columns of [1, 2, 3, 4, 5, 6]) {
      expect(rowsOf(five, columns).flat()).toEqual(five);
    }
  });

  it("does not lose the weeds if it is asked for no columns", () => {
    expect(rowsOf(five, 0).flat()).toEqual(five);
  });

  it("agrees with the sheets it is used for", () => {
    expect(rowsOf(five, columnsFor("client"))).toEqual([["a", "b", "c", "d"], ["e"]]);
    expect(rowsOf(five, columnsFor("crew"))).toEqual([five]);
  });
});

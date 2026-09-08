import { describe, expect, it } from "vitest";

import {
  columnsFor,
  groupWeeds,
  isSheetView,
  WEED_GROUPS,
  WEED_SEED,
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

import { describe, expect, it } from "vitest";

import { compressAddresses, describePlays, flyerRoutesOf, groupPlays, playDetail, playTitle, shortAddress, summarizePlays, type MarketingPlay } from "./marketing-plays";

function play(over: Partial<MarketingPlay>): MarketingPlay {
  return {
    id: "p",
    houseId: "h",
    address: "208 Crafton Road, Bel Air, Maryland 21014, United States",
    lat: 39.5,
    lng: -76.3,
    jobId: "j",
    customerId: "c",
    customerName: "Pat",
    reason: "client",
    kind: "knocks",
    quantity: 5,
    zoneId: "z",
    zoneName: "21014 C030",
    zoneMode: "foot",
    targets: [],
    status: "open",
    doneAt: null,
    doneBy: null,
    mailingId: null,
    createdAt: "2026-09-06T10:00:00Z",
    targetAddresses: null,
    ...over,
  };
}

describe("addresses", () => {
  it("shortens the geocoder's line and runs one street's numbers together", () => {
    expect(shortAddress("208 Crafton Road, Bel Air, Maryland 21014, United States")).toBe("208 Crafton Road");
    expect(
      compressAddresses([
        "206 Crafton Road, Bel Air, Maryland 21014",
        "209 Crafton Road, Bel Air, Maryland 21014",
        "211 Crafton Road, Bel Air, Maryland 21014",
        "301 Wakefield Drive, Bel Air, Maryland 21014",
      ])
    ).toBe("206, 209 and 211 Crafton Road and 301 Wakefield Drive");
  });
});

describe("what a play says", () => {
  it("titles and details each kind", () => {
    expect(playTitle(play({ kind: "yard_sign", quantity: 1 }))).toBe("Put up the yard sign");
    expect(playTitle(play({ kind: "door_hangers", quantity: 100 }))).toBe("100 door hangers");
    expect(playTitle(play({ kind: "flyers", quantity: 1016 }))).toBe("1,016 flyers by mail");
    expect(playDetail(play({ targetAddresses: ["206 Crafton Road, Bel Air", "207 Crafton Road, Bel Air"] }))).toContain("206 and 207 Crafton Road");
    expect(playDetail(play({ kind: "door_hangers", quantity: 100 }))).toContain("zone 21014 C030");
    const flyers = play({
      kind: "flyers",
      quantity: 1016,
      targets: [
        { id: "r1", zip: "21014", routeId: "C010", residential: 518, business: 20, total: 538, facility: "BEL AIR", pieces: 518 },
        { id: "r2", zip: "21014", routeId: "C005", residential: 498, business: 0, total: 498, facility: "BEL AIR", pieces: 498 },
      ],
    });
    expect(flyerRoutesOf(flyers)).toHaveLength(2);
    expect(playDetail(flyers)).toBe("USPS routes 21014 C010 (518), C005 (498), dropped at BEL AIR.");
    expect(playDetail(play({ kind: "flyers", targets: [] }))).toMatch(/No USPS route/);
  });
});

describe("the list", () => {
  it("groups by house, open houses first, the set in the order it is done", () => {
    const groups = groupPlays([
      play({ id: "a", houseId: "h1", kind: "flyers", createdAt: "2026-09-01T00:00:00Z" }),
      play({ id: "b", houseId: "h1", kind: "yard_sign", createdAt: "2026-09-01T00:00:00Z" }),
      play({ id: "c", houseId: "h2", kind: "door_hangers", reason: "evaluation", status: "done", createdAt: "2026-09-05T00:00:00Z" }),
      play({ id: "d", houseId: "h3", kind: "door_hangers", reason: "evaluation", createdAt: "2026-09-03T00:00:00Z" }),
    ]);
    expect(groups.map((g) => g.houseId)).toEqual(["h3", "h1", "h2"]);
    expect(groups[1].plays.map((p) => p.kind)).toEqual(["yard_sign", "flyers"]);
    expect(groups[1].reason).toBe("client");
    expect(groups[2].open).toBe(0);
  });
  it("counts what is left to do", () => {
    const summary = summarizePlays([
      play({ kind: "door_hangers", quantity: 100 }),
      play({ kind: "flyers", quantity: 1016 }),
      play({ kind: "knocks", status: "done" }),
      play({ kind: "yard_sign", status: "skipped" }),
    ]);
    expect(summary).toEqual({ open: 2, done: 1, hangersToGo: 100, flyersToGo: 1016 });
    expect(describePlays(summary)).toBe("2 to do, 100 hangers to hang, 1,016 flyers to mail.");
    expect(describePlays({ open: 0, done: 0, hangersToGo: 0, flyersToGo: 0 })).toMatch(/on its own/);
  });
});

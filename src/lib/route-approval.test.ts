import { describe, expect, it } from "vitest";

import { doorsAlongLines, nextMonday, paidInFull, pickRoute, plusDays, routeName, stepQuestion } from "./route-approval";

describe("paidInFull", () => {
  it("is paid when the app took the money", () => {
    expect(paidInFull({ collectedCents: 0, priceCents: 390_000, discountCents: 0, paidAt: "2026-09-02T00:15:26Z" })).toBe(true);
  });
  it("is paid when what came in covers the price after the discount", () => {
    expect(paidInFull({ collectedCents: 351_000, priceCents: 390_000, discountCents: 39_000, paidAt: null })).toBe(true);
    expect(paidInFull({ collectedCents: 350_000, priceCents: 390_000, discountCents: 39_000, paidAt: null })).toBe(false);
  });
  it("is not paid when nothing came in, whatever the price", () => {
    expect(paidInFull({ collectedCents: 0, priceCents: 0, discountCents: 0, paidAt: null })).toBe(false);
    expect(paidInFull({ collectedCents: 0, priceCents: null, discountCents: 0, paidAt: null })).toBe(false);
    expect(paidInFull({ collectedCents: 6_500, priceCents: null, discountCents: 0, paidAt: null })).toBe(true);
  });
});

describe("pickRoute", () => {
  const a = { eddmRouteId: "a", since: "2026-09-06", houseIds: ["h1"], status: null };
  const b = { eddmRouteId: "b", since: "2026-09-02", houseIds: ["h2"], status: null };
  it("takes the one waiting longest", () => {
    expect(pickRoute([a, b])?.eddmRouteId).toBe("b");
  });
  it("finishes a route already under way before starting another", () => {
    expect(pickRoute([a, { ...b, status: "skipped" as const }, { eddmRouteId: "c", since: "2026-09-10", houseIds: [], status: "draw" as const }])?.eddmRouteId).toBe("c");
  });
  it("has nothing to ask when every route is dealt with", () => {
    expect(pickRoute([{ ...a, status: "ordered" as const }])).toBeNull();
  });
});

describe("doorsAlongLines", () => {
  // A street running east along one line of latitude; houses either side.
  const houses = [
    { id: "far", address: "far", lat: 39.51, lng: -76.35 },
    { id: "w", address: "w", lat: 39.5001, lng: -76.353 },
    { id: "e", address: "e", lat: 39.4999, lng: -76.351 },
  ];
  it("orders the doors as they fall along the drawn line and leaves the rest", () => {
    const { order, line } = doorsAlongLines(houses, [[{ lat: 39.5, lng: -76.354 }, { lat: 39.5, lng: -76.35 }]]);
    expect(order).toEqual(["w", "e"]);
    expect(line).toHaveLength(2);
  });
  it("joins several lines into one walk, first line first", () => {
    const { order } = doorsAlongLines(houses, [
      [{ lat: 39.5, lng: -76.3512 }, { lat: 39.5, lng: -76.35 }],
      [{ lat: 39.5, lng: -76.354 }, { lat: 39.5, lng: -76.352 }],
    ]);
    expect(order).toEqual(["e", "w"]);
  });
});

describe("wording and dates", () => {
  it("asks one plain question per step", () => {
    const facts = { routeId: "C029", zip: "21014", pieces: 461, doors: 38 };
    expect(stepQuestion("usps", facts)).toBe("Approve USPS route C029 in 21014 for 461 mailers?");
    expect(stepQuestion("hangers", facts)).toBe("Hang 38 door hangers along that line?");
    expect(routeName(facts)).toBe("Route C029 in 21014");
  });
  it("defaults the walk to next Monday and the mail a week on", () => {
    expect(nextMonday(new Date("2026-09-21T15:00:00Z"))).toBe("2026-09-28");
    expect(nextMonday(new Date("2026-09-23T15:00:00Z"))).toBe("2026-09-28");
    expect(plusDays("2026-09-28", 7)).toBe("2026-10-05");
  });
});

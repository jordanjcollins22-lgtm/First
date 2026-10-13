import { describe, expect, it } from "vitest";

import { bandFor, recommendApplication, suggestSnowEvent } from "@/lib/snow/application";
import { prepaidDraw, servicedNotice, snowBillFor, type LoggedStop, type SnowContract } from "@/lib/snow/billing";
import { orderRoute } from "@/lib/snow/route";

describe("application rates", () => {
  it("goes up as the surface gets colder", () => {
    const at = (t: number) => recommendApplication({ surfaceTempF: t, product: "rock_salt", pretreated: false, areaSqft: 10_000 }).pounds;
    expect(at(32)).toBe(25);
    expect(at(27)).toBe(40);
    expect(at(22)).toBe(55);
    expect(at(16)).toBe(75);
  });
  it("puts down less on a pre-treated surface", () => {
    const plain = recommendApplication({ surfaceTempF: 28, product: "rock_salt", pretreated: false, areaSqft: 10_000 });
    const pre = recommendApplication({ surfaceTempF: 28, product: "rock_salt", pretreated: true, areaSqft: 10_000 });
    expect(pre.pounds).toBeLessThan(plain.pounds);
  });
  it("refuses rock salt below about 15°F rather than giving a bigger number", () => {
    const advice = recommendApplication({ surfaceTempF: 10, product: "rock_salt", pretreated: false, areaSqft: 10_000 });
    expect(advice.works).toBe(false);
    expect(advice.pounds).toBe(0);
    expect(advice.note).toMatch(/calcium chloride/i);
  });
  it("lets calcium chloride work cold, and thinner than rock salt", () => {
    const cacl = recommendApplication({ surfaceTempF: 10, product: "calcium_chloride", pretreated: false, areaSqft: 10_000 });
    expect(cacl.works).toBe(true);
    const warm = recommendApplication({ surfaceTempF: 30, product: "calcium_chloride", pretreated: false, areaSqft: 10_000 });
    expect(warm.pounds).toBeLessThan(25);
  });
  it("scales a residential base amount by temperature when there is no area", () => {
    const mild = recommendApplication({ surfaceTempF: 31, product: "calcium_chloride", pretreated: false, basePounds: 2 });
    const cold = recommendApplication({ surfaceTempF: 18, product: "calcium_chloride", pretreated: false, basePounds: 2 });
    expect(mild.pounds).toBe(2);
    expect(cold.pounds).toBe(6);
  });
  it("won't pre-treat with brine when it would refreeze", () => {
    expect(recommendApplication({ surfaceTempF: 15, product: "brine", pretreated: false, areaSqft: 4000 }).works).toBe(false);
    expect(recommendApplication({ surfaceTempF: 28, product: "brine", pretreated: false, areaSqft: 4000 }).gallons).toBe(2);
  });
  it("bands by surface temperature", () => {
    expect(bandFor(40).fromF).toBe(30);
    expect(bandFor(-5).fromF).toBe(-100);
  });
});

describe("suggestSnowEvent", () => {
  const day = (over: Partial<Parameters<typeof suggestSnowEvent>[0][number]>) => ({ date: "2026-12-10", snowIn: 0, rainIn: 0, code: 3, tempMinF: 35, tempMaxF: 45, ...over });
  it("suggests nothing for a dry or warm forecast", () => {
    expect(suggestSnowEvent([day({}), day({ snowIn: 0.5, tempMinF: 36 })], 1)).toBeNull();
  });
  it("suggests salting for light snow on a freezing day, with no fixed trigger", () => {
    const s = suggestSnowEvent([day({ snowIn: 0.3, tempMinF: 25 })], 1);
    expect(s?.service).toBe("salt");
    expect(s?.note).toMatch(/Pre-treat/);
  });
  it("suggests salting for freezing rain whatever the depth", () => {
    expect(suggestSnowEvent([day({ code: 66, tempMinF: 30 })], 1)?.service).toBe("salt");
  });
  it("suggests plowing at the trigger depth", () => {
    expect(suggestSnowEvent([day({ snowIn: 3, tempMinF: 22 })], 2)?.service).toBe("plow");
  });
  it("says when it's too cold to pre-treat", () => {
    expect(suggestSnowEvent([day({ snowIn: 2, tempMinF: 10 })], 1)?.note).toMatch(/Too cold/);
  });
});

describe("snow billing", () => {
  const contract = (over: Partial<SnowContract>): SnowContract => ({
    type: "per_push",
    ratePerPushCents: 7500,
    ratePerApplicationCents: 4500,
    ratePerEventCents: 15000,
    seasonalPriceCents: 120000,
    ...over,
  });
  const stop = (over: Partial<LoggedStop> = {}): LoggedStop => ({
    status: "done",
    servicedAt: "2026-12-10T10:12:00Z",
    service: "plow_and_salt",
    pushes: 2,
    applications: 1,
    saltLbs: 40,
    depthIn: 3,
    photoCount: 2,
    ...over,
  });

  it("bills per push", () => {
    const bill = snowBillFor(contract({}), stop(), "Snow Dec 10", "5:12 AM");
    expect(bill).toMatchObject({ bill: true, amountCents: 15000, quantity: 2 });
    if (bill.bill) {
      expect(bill.description).toContain("2 pushes at $75");
      expect(bill.description).toContain("5:12 AM");
      expect(bill.description).toContain("2 photos");
    }
  });
  it("counts one push when the stop was plowed and nobody counted", () => {
    expect(snowBillFor(contract({}), stop({ pushes: 0 }), "e", null)).toMatchObject({ amountCents: 7500 });
  });
  it("bills per application and per event", () => {
    expect(snowBillFor(contract({ type: "per_application" }), stop({ applications: 2 }), "e", null)).toMatchObject({ amountCents: 9000 });
    expect(snowBillFor(contract({ type: "per_event" }), stop(), "e", null)).toMatchObject({ amountCents: 15000 });
  });
  it("never bills a seasonal or prepaid client per event", () => {
    expect(snowBillFor(contract({ type: "seasonal" }), stop(), "e", null).bill).toBe(false);
    expect(snowBillFor(contract({ type: "prepaid" }), stop(), "e", null).bill).toBe(false);
  });
  it("never invents a rate", () => {
    const bill = snowBillFor(contract({ ratePerPushCents: null }), stop(), "e", null);
    expect(bill).toMatchObject({ bill: false });
    if (!bill.bill) expect(bill.reason).toMatch(/No per push rate/);
  });
  it("does not bill a stop that was skipped or not reached", () => {
    expect(snowBillFor(contract({}), stop({ status: "skipped" }), "e", null).bill).toBe(false);
    expect(snowBillFor(contract({}), stop({ status: "pending" }), "e", null).bill).toBe(false);
  });
  it("draws one prepaid treatment per application", () => {
    expect(prepaidDraw(stop({ applications: 0, service: "salt" }))).toBe(1);
    expect(prepaidDraw(stop({ applications: 2 }))).toBe(2);
    expect(prepaidDraw(stop({ status: "pending" }))).toBe(0);
  });
  it("tells the client when their property was serviced", () => {
    expect(servicedNotice({ firstName: "Bo", business: "JS Landscaping", timeText: "5:12 AM", proofUrl: "https://x/y" })).toBe(
      "Hi Bo, JS Landscaping here. Your property was serviced at 5:12 AM. Photos: https://x/y"
    );
  });
});

describe("orderRoute", () => {
  const shop = { lat: 39.0, lng: -76.9 };
  it("puts the office's order first, then the nearest next stop, then the unplaceable", () => {
    const route = orderRoute(
      [
        { id: "far", name: "Far", lat: 39.3, lng: -76.9, routeOrder: null },
        { id: "near", name: "Near", lat: 39.01, lng: -76.9, routeOrder: null },
        { id: "first", name: "Hospital", lat: 39.5, lng: -76.9, routeOrder: 1 },
        { id: "nowhere", name: "No pin", lat: null, lng: null, routeOrder: null },
      ],
      shop
    );
    // After the hospital (39.5), Far (39.3) is nearer than Near (39.01).
    expect(route.map((s) => s.id)).toEqual(["first", "far", "near", "nowhere"]);
  });
  it("starts from the shop when nothing is ordered", () => {
    const route = orderRoute(
      [
        { id: "far", name: "Far", lat: 39.3, lng: -76.9, routeOrder: null },
        { id: "near", name: "Near", lat: 39.01, lng: -76.9, routeOrder: null },
      ],
      shop
    );
    expect(route.map((s) => s.id)).toEqual(["near", "far"]);
  });
});

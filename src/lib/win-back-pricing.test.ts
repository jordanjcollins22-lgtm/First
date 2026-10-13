import { describe, expect, it } from "vitest";

import type { ProposalZoneSnapshot } from "@/types/domain";
import { autoPhaseOne, phaseOnePrice, pricedPhaseOneSnapshot, winBackDedupeKey, winBackMessage, zonePrices } from "@/lib/win-back";

const zone = (zoneName: string, priceCents?: number | null, priceDerived = true): ProposalZoneSnapshot => ({
  zoneName,
  serviceLabel: "Beds",
  scopeText: "",
  photoPaths: [],
  points: [],
  color: "#000",
  priceCents,
  priceDerived,
});

describe("zonePrices (hotspot 12)", () => {
  it("uses each area's own price where the proposal recorded one", () => {
    expect(zonePrices([zone("A", 300000), zone("B", 200000)], 500000).map((a) => [a.priceCents, a.estimated])).toEqual([
      [300000, false],
      [200000, false],
    ]);
  });

  it("shares what's left of the total across areas that were never priced, to the cent", () => {
    const prices = zonePrices([zone("A", 300000), zone("B", null), zone("C")], 500001);
    expect(prices.map((a) => a.priceCents)).toEqual([300000, 100001, 100000]);
    expect(prices.map((a) => a.estimated)).toEqual([false, true, true]);
    expect(prices.reduce((s, a) => s + a.priceCents, 0)).toBe(500001);
  });

  it("never lets the parts come to more than the whole", () => {
    const prices = zonePrices([zone("A", 400000), zone("B", 400000)], 600000);
    expect(prices.map((a) => a.priceCents)).toEqual([300000, 300000]);
  });
});

describe("Phase 1 prices itself", () => {
  const snapshot = [zone("Front beds", 400000), zone("Patio", 1200000), zone("Back beds", 400000)];

  it("adds up the areas kept, less the same share of the discount", () => {
    expect(phaseOnePrice({ snapshot, keep: ["Front beds", "Back beds"], total: 20000, discount: 0 })).toBe(8000);
    expect(phaseOnePrice({ snapshot, keep: ["Front beds"], total: 20000, discount: 2000 })).toBe(3600);
    expect(phaseOnePrice({ snapshot, keep: [], total: 20000, discount: 0 })).toBeNull();
  });

  it("writes each kept area's price onto the stored Phase 1", () => {
    const phase = pricedPhaseOneSnapshot(snapshot, ["Back beds", "Front beds"], 2000000, 0.9)!;
    expect(phase.map((z) => [z.zoneName, z.priceCents, z.priceDerived])).toEqual([
      ["Front beds", 360000, false],
      ["Back beds", 360000, false],
    ]);
    const full = pricedPhaseOneSnapshot(snapshot, ["Front beds"], 2000000)!;
    expect(full[0].priceDerived).toBe(true);
  });

  it("offers the first areas that fit under the cap, never all of them", () => {
    expect(autoPhaseOne({ snapshot, total: 20000, discount: 0 })).toEqual({ keep: ["Front beds"], price: 4000 });
    const small = [zone("A", 100000), zone("B", 100000), zone("C", 100000)];
    expect(autoPhaseOne({ snapshot: small, total: 3000, discount: 0 })).toEqual({ keep: ["A"], price: 1000 });
    expect(autoPhaseOne({ snapshot: [zone("Only", 500000)], total: 5000, discount: 0 })).toBeNull();
  });
});

describe("the automatic win-back", () => {
  it("names the offer and its price", () => {
    const msg = winBackMessage({ day: 30, channel: "sms", businessName: "JS", clientName: "Sam Lee", phaseOne: { areas: ["Front beds"], price: 4000 } });
    expect(msg.body).toContain("We could start with Front beds for $4,000");
    expect(winBackMessage({ day: 180, channel: "email", businessName: "JS", clientName: null, phaseOne: null }).body).toContain("new season");
    expect(winBackDedupeKey("j1", 90, "email")).toBe("win_back:j1:90:email");
  });
});

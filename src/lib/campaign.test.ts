import { describe, expect, it } from "vitest";

import {
  afterCredit,
  campaignHeadline,
  chooseVariant,
  DEFAULT_PRICING,
  DEFAULT_RAMP,
  DEFAULT_VARIANTS,
  estimateLawnSqft,
  offerState,
  pauseReason,
  priceAeration,
  pricingFrom,
  renderCampaign,
  todaysCap,
  variantScore,
  variantShares,
  type VariantStats,
} from "@/lib/campaign";

describe("pricing a lawn", () => {
  it("sizes the lawn from the lot and the house", () => {
    // A quarter acre with a 2,000 sq ft house: (10,890 - 2,000) * 0.85.
    expect(estimateLawnSqft({ acreage: 0.25, sqft: 2000 })).toBe(7557);
    expect(estimateLawnSqft({ acreage: null, sqft: 2000 })).toBeNull();
    // No house size known: assume fifteen percent of the lot is house.
    expect(estimateLawnSqft({ acreage: 0.25, sqft: null })).toBe(7868);
    // Nothing is ever priced as a postage stamp.
    expect(estimateLawnSqft({ acreage: 0.02, sqft: 2000 })).toBe(1500);
  });

  it("charges seed and time and the machine, and never less than the minimum", () => {
    const small = priceAeration(DEFAULT_PRICING, 4000);
    expect(small.seedCents).toBe(7200);
    expect(small.laborCents).toBe(3467);
    expect(small.subtotalCents).toBe(20667);
    expect(small.totalCents).toBe(65000);
    expect(small.minimumApplied).toBe(true);

    const big = priceAeration(DEFAULT_PRICING, 30000);
    expect(big.totalCents).toBe(big.subtotalCents);
    expect(big.minimumApplied).toBe(false);
    expect(afterCredit(50000, 1743)).toBe(48257);
    expect(afterCredit(1000, 1743)).toBe(0);
  });

  it("takes whatever pricing was saved and fills the gaps with defaults", () => {
    expect(pricingFrom({ minimumCents: 60000, lawnShare: 5 })).toEqual({ ...DEFAULT_PRICING, minimumCents: 60000, lawnShare: 1 });
    expect(pricingFrom(null)).toEqual(DEFAULT_PRICING);
  });
});

describe("sending a little at a time", () => {
  it("ramps then holds at the cap", () => {
    expect([0, 1, 2, 3, 4, 40].map((d) => todaysCap(DEFAULT_RAMP, d))).toEqual([25, 50, 100, 150, 200, 200]);
    expect(todaysCap({ steps: [500], cap: 200 }, 0)).toBe(200);
  });

  it("stops itself when the receivers start objecting", () => {
    expect(pauseReason({ sent: 10, bounced: 0, complained: 0 })).toBeNull();
    expect(pauseReason({ sent: 10, bounced: 3, complained: 0 })).toBeNull();
    expect(pauseReason({ sent: 100, bounced: 4, complained: 0 })).toMatch(/bounced/);
    expect(pauseReason({ sent: 10, bounced: 0, complained: 2 })).toMatch(/spam/);
    expect(pauseReason({ sent: 500, bounced: 0, complained: 1 })).toMatch(/one in a thousand/);
  });
});

describe("leaning on the wording that books", () => {
  const v = (key: string, sent: number, clicked: number, booked: number, needsPrice = false): VariantStats => ({
    id: key,
    key,
    enabled: true,
    needsPrice,
    sent,
    clicked,
    booked,
  });

  it("scores a booking as three clicks and doubts a tiny sample", () => {
    expect(variantScore({ sent: 0, clicked: 0, booked: 0 })).toBeCloseTo(0.25);
    expect(variantScore({ sent: 2, clicked: 0, booked: 1 })).toBeCloseTo(4 / 6);
    expect(variantScore({ sent: 100, clicked: 10, booked: 2 })).toBeCloseTo(17 / 104);
  });

  it("gives the winner most of the next sends and the loser never less than fifteen percent", () => {
    const variants = [v("A", 200, 40, 12), v("B", 200, 4, 0), v("C", 200, 10, 2)];
    const shares = variantShares(variants);
    expect(shares.A).toBeGreaterThan(shares.C);
    expect(shares.C).toBeGreaterThan(shares.B);
    expect(shares.B).toBeGreaterThanOrEqual(0.15 / (1 + 0.15));
    // A roll near zero lands on the first wording, near one on the last.
    expect(chooseVariant(variants, 0, true)?.key).toBe("A");
    expect(chooseVariant(variants, 0.999, true)?.key).toBe("C");
  });

  it("never sends a priced wording to somebody whose lawn we cannot size", () => {
    const variants = [v("A", 0, 0, 0), v("C", 0, 0, 0, true)];
    for (const roll of [0, 0.5, 0.99]) expect(chooseVariant(variants, roll, false)?.key).toBe("A");
    expect(chooseVariant([v("C", 0, 0, 0, true)], 0.5, false)).toBeNull();
  });
});

describe("the words", () => {
  it("fills every brace in every default wording", () => {
    const vars = {
      first_name: "Deanna",
      credit: "$17.43",
      expires: "Friday, September 19",
      code: "LAWN-7K3Q",
      address: "1613 Bimini Drive, Bel Air",
      lawn_size: "about 6,500 sq ft",
      price: "$512.00",
      total: "$494.57",
      offer_link: "https://app.example.com/offer/abc",
      business: "JS Landscaping MD",
      phone: "(443) 819-1521",
      signoff: "Jordan",
    };
    for (const variant of DEFAULT_VARIANTS) {
      const out = renderCampaign(`${variant.subject}\n${variant.body}`, vars);
      expect(out).not.toMatch(/\{[a-z_]+\}/);
      expect(out).not.toContain("—");
      expect(out).toContain("LAWN-7K3Q");
    }
  });

  it("says where the campaign stands", () => {
    expect(campaignHeadline({ queued: 886, sent: 0, skipped: 0, bounced: 0, complained: 0, unsubscribed: 0, clicked: 0, booked: 0, bookedCents: 0, sendDays: 0 })).toBe(
      "886 people queued. Nothing sent yet."
    );
    expect(campaignHeadline({ queued: 700, sent: 186, skipped: 2, bounced: 1, complained: 0, unsubscribed: 1, clicked: 30, booked: 4, bookedCents: 200000, sendDays: 3 })).toBe(
      "186 sent, 30 opened the offer, 4 booked, $2,000.00, 700 to go."
    );
  });

  it("knows when a code is spent, expired or closed", () => {
    expect(offerState({ campaignStatus: "running", expiresOn: "2026-09-19", bookedAt: null, today: "2026-09-14" })).toEqual({ ok: true });
    expect(offerState({ campaignStatus: "running", expiresOn: "2026-09-19", bookedAt: "x", today: "2026-09-14" })).toEqual({ ok: false, reason: "booked" });
    expect(offerState({ campaignStatus: "running", expiresOn: "2026-09-19", bookedAt: null, today: "2026-09-20" })).toEqual({ ok: false, reason: "expired" });
    expect(offerState({ campaignStatus: "done", expiresOn: "2026-09-19", bookedAt: null, today: "2026-09-14" })).toEqual({ ok: false, reason: "closed" });
  });
});

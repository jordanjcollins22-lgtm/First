import { describe, expect, it } from "vitest";

import type { ProposalZoneSnapshot } from "@/types/domain";
import { escalate, isRecurringService, nextSeason, pickRenewals, renewalKey, renewalOffer, snowSeason, type RenewalSource } from "@/lib/client-automations/campaigns";

const zone = (zoneName: string, serviceLabel: string, priceCents?: number): ProposalZoneSnapshot => ({
  zoneName,
  serviceLabel,
  scopeText: "",
  photoPaths: ["a.jpg"],
  points: [],
  color: "#000",
  ...(priceCents != null ? { priceCents } : {}),
});

const source = (over: Partial<RenewalSource> = {}): RenewalSource => ({
  customerId: "c1",
  propertyId: "p1",
  jobId: "j1",
  address: "1 Main St",
  clientName: "Ann Lee",
  acceptedAt: "2026-04-01T00:00:00Z",
  snapshot: [zone("Front lawn", "Lawn mowing", 120000), zone("Patio", "Paver patio", 900000)],
  total: 10200,
  ...over,
});

describe("what renews", () => {
  it("knows recurring work from one-off work", () => {
    expect(isRecurringService("Lawn mowing")).toBe(true);
    expect(isRecurringService("Fertilization program")).toBe(true);
    expect(isRecurringService("Spring clean-up")).toBe(true);
    expect(isRecurringService("Salting")).toBe(true);
    expect(isRecurringService("Paver patio")).toBe(false);
    expect(isRecurringService("Retaining wall")).toBe(false);
  });

  it("raises by the escalator, to the dollar", () => {
    expect(escalate(120000, 4)).toBe(124800);
    expect(escalate(99999, 4)).toBe(104000);
    expect(escalate(50000, 0)).toBe(50000);
  });

  it("renews only the recurring areas, at the new price, without last year's photos", () => {
    const offer = renewalOffer(source(), 4)!;
    expect(offer.areas.map((a) => a.zoneName)).toEqual(["Front lawn"]);
    expect(offer.lastCents).toBe(120000);
    expect(offer.newCents).toBe(124800);
    expect(offer.areas[0].photoPaths).toEqual([]);
    expect(renewalOffer(source({ snapshot: [zone("Patio", "Paver patio", 900000)] }), 4)).toBeNull();
  });

  it("shares the total across areas that were never priced", () => {
    const offer = renewalOffer(source({ snapshot: [zone("Lawn", "Lawn mowing"), zone("Beds", "Mulch")], total: 2000 }), 0)!;
    expect(offer.areas.map((a) => a.priceCents)).toEqual([100000, 100000]);
  });

  it("picks each client's latest recurring job inside eighteen months", () => {
    const now = new Date("2026-10-13T00:00:00Z");
    const offers = pickRenewals(
      [
        source({ jobId: "old", acceptedAt: "2024-01-01T00:00:00Z" }),
        source({ jobId: "a", acceptedAt: "2026-03-01T00:00:00Z" }),
        source({ jobId: "b", acceptedAt: "2026-05-01T00:00:00Z" }),
        source({ customerId: "c2", jobId: "patio", snapshot: [zone("Patio", "Paver patio", 900000)] }),
      ],
      4,
      now
    );
    expect(offers.map((o) => o.fromJobId)).toEqual(["b"]);
    expect(renewalKey("c1", "2027", "email")).toBe("renewal:2027:c1:email");
  });
});

describe("seasons", () => {
  it("is the next season start, and the campaign 45 days before", () => {
    expect(nextSeason(new Date("2026-10-13T00:00:00Z"), "03-15", 45)).toEqual({ season: "2027", startsOn: "2027-03-15", dueOn: "2027-01-29" });
    expect(nextSeason(new Date("2027-01-02T00:00:00Z"), "03-15", 45).season).toBe("2027");
    expect(nextSeason(new Date("2027-03-12T00:00:00Z"), "03-15", 45).season).toBe("2028");
  });

  it("calls the winter by both its years", () => {
    expect(snowSeason(new Date("2026-10-13T00:00:00Z"))).toBe("2026-27");
    expect(snowSeason(new Date("2027-01-20T00:00:00Z"))).toBe("2026-27");
  });
});

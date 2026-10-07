import { describe, expect, it } from "vitest";

import { DEFAULT_PROFILE } from "../profile";
import { scoreOpportunity } from "../scoring";
import { classifyTrade } from "../trades";
import type { Opportunity } from "../types";

const NOW = new Date("2026-10-07T12:00:00Z");

function opp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    externalId: "x",
    source: "sam_csv",
    noticeType: "combined_synopsis_solicitation",
    title: "Grounds Maintenance and Mowing Services",
    solicitationNumber: "W1",
    agency: "DEPT OF THE ARMY",
    office: null,
    naicsCode: "561730",
    pscCode: "S208",
    setAside: "small_business",
    setAsideLabel: "Total Small Business",
    postedDate: "2026-10-01T00:00:00Z",
    responseDeadline: "2026-10-25T17:00:00Z",
    placeOfPerformance: { city: "Fort Hancock", state: "NJ", zip: "07732", country: "USA" },
    pointsOfContact: [],
    description: "Mow and trim 40 acres.",
    url: null,
    attachmentUrls: [],
    estimatedValue: null,
    active: true,
    ...overrides,
  };
}

describe("classifyTrade", () => {
  it("prefers title keywords over generic construction codes", () => {
    expect(classifyTrade({ title: "Replace 14 ton heat pump, Bldg 26", naicsCode: "236220", pscCode: "Z2AA" })?.trade.key).toBe("hvac");
  });

  it("ignores product purchases and unrelated work", () => {
    expect(classifyTrade({ title: "Medical refrigerator", pscCode: "6530" })).toBeNull();
    expect(classifyTrade({ title: "Maintenance Service for Portable Fire Extinguishers", pscCode: "J042" })).toBeNull();
    expect(classifyTrade({ title: "Software licenses", naicsCode: "511210" })).toBeNull();
  });
});

describe("scoreOpportunity", () => {
  it("recommends bidding a clean small-business grounds contract", () => {
    const s = scoreOpportunity(opp(), DEFAULT_PROFILE, { now: NOW });
    expect(s.recommendation).toBe("bid");
    expect(s.trade).toBe("landscaping");
    expect(s.disqualifiers).toEqual([]);
    expect(s.total).toBeGreaterThanOrEqual(70);
  });

  it("disqualifies set-asides we can't bid, short deadlines and clearances", () => {
    expect(scoreOpportunity(opp({ setAside: "8a" }), DEFAULT_PROFILE, { now: NOW }).recommendation).toBe("no_bid");
    expect(scoreOpportunity(opp({ responseDeadline: "2026-10-09T17:00:00Z" }), DEFAULT_PROFILE, { now: NOW }).recommendation).toBe("no_bid");
    expect(scoreOpportunity(opp({ description: "Contractor personnel require a SECRET clearance." }), DEFAULT_PROFILE, { now: NOW }).recommendation).toBe("no_bid");
  });

  it("treats sources sought as an early-warning maybe, not a bid", () => {
    const s = scoreOpportunity(opp({ noticeType: "sources_sought" }), DEFAULT_PROFILE, { now: NOW });
    expect(s.recommendation).not.toBe("bid");
  });

  it("flags subcontracting limits once the clause is found", () => {
    const s = scoreOpportunity(opp(), DEFAULT_PROFILE, { now: NOW, losClausePresent: true });
    expect(s.subcontracting.status).toBe("similarly_situated_required");
    expect(s.flags.some((f) => f.includes("50%"))).toBe(true);
  });

  it("respects target states", () => {
    const s = scoreOpportunity(opp(), { ...DEFAULT_PROFILE, states: ["TX"] }, { now: NOW });
    expect(s.recommendation).toBe("no_bid");
  });
});

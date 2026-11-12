import { describe, expect, it } from "vitest";
import { UNTAGGED, adsTracker, finalUrlSuffix } from "./ads-tracker";

const lead = (detail: string | null, sold: boolean, collected: number, group = "Google ad") => ({ source: { group, detail }, sold, collected });

describe("adsTracker", () => {
  it("joins each campaign's spend to the leads and money its links brought in", () => {
    const rows = adsTracker(
      [
        { campaign: "Spring cleanups", amountCents: 30000, clicks: 120 },
        { campaign: "Spring cleanups", amountCents: 10000, clicks: 40 },
        { campaign: "Mulch", amountCents: 5000, clicks: 20 },
      ],
      [lead("Spring cleanups", true, 1200), lead("Spring cleanups", false, 0), lead("Mulch", false, 0), lead(null, true, 500), lead("x", true, 999, "Flyer")]
    );
    expect(rows[0]).toEqual({ campaign: "Spring cleanups", spend: 400, clicks: 160, leads: 2, sold: 1, collected: 1200, costPerLead: 200, returnPerDollar: 3 });
    expect(rows[1]).toMatchObject({ campaign: "Mulch", spend: 50, leads: 1, costPerLead: 50, returnPerDollar: 0 });
    expect(rows[2]).toMatchObject({ campaign: UNTAGGED, spend: 0, leads: 1, sold: 1, collected: 500, returnPerDollar: null });
  });

  it("shows a campaign that spent with no leads yet", () => {
    expect(adsTracker([{ campaign: "Snow", amountCents: 2500, clicks: 9 }], [])[0]).toMatchObject({ leads: 0, costPerLead: null, returnPerDollar: 0 });
  });
});

describe("finalUrlSuffix", () => {
  it("puts the campaign name on the link in the form the booking page keeps", () => {
    expect(finalUrlSuffix("Spring cleanups")).toBe("utm_source=google&utm_medium=cpc&utm_campaign=Spring+cleanups");
    expect(finalUrlSuffix("Fall <sale>!")).toBe("utm_source=google&utm_medium=cpc&utm_campaign=Fall+sale");
  });
});

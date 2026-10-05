import { describe, expect, it } from "vitest";

import { leadSource, summariseSources, type LeadClues } from "@/lib/lead-sources";

const none: LeadClues = {
  adSource: null,
  adCampaign: null,
  gclid: false,
  fbclid: false,
  linkKind: null,
  linkPlatform: null,
  linkOwner: null,
  referredByName: null,
  campaignWave: false,
  clientReferral: false,
  fromOldCalendar: false,
  typedSource: null,
  quickMow: false,
};

describe("where a lead came from", () => {
  it("takes the most specific clue", () => {
    expect(leadSource({ ...none, gclid: true, adCampaign: "Fall cleanup", linkKind: "comment" })).toEqual({ group: "Google ad", detail: "Fall cleanup" });
    expect(leadSource({ ...none, linkKind: "comment", linkPlatform: "facebook", linkOwner: "Jace", referredByName: "Jace" })).toEqual({ group: "Facebook comment", detail: "Jace" });
    expect(leadSource({ ...none, linkKind: "dm", linkPlatform: "facebook" }).group).toBe("Facebook message");
    expect(leadSource({ ...none, referredByName: "Max" })).toEqual({ group: "Affiliate's booking link", detail: "Max" });
    expect(leadSource({ ...none, fromOldCalendar: true }).group).toBe("GoHighLevel calendar");
    expect(leadSource({ ...none, typedSource: "Booked by phone" }).group).toBe("Booked by phone");
    expect(leadSource(none).group).toBe("Booked online, no trail");
  });

  it("adds up leads, sales and money per source", () => {
    const rows = summariseSources([
      { source: { group: "Facebook comment", detail: "Jace" }, sold: true, revenue: 650 },
      { source: { group: "Facebook comment", detail: "Max" }, sold: false, revenue: 0 },
      { source: { group: "Facebook comment", detail: "Jace" }, sold: false, revenue: 0 },
      { source: { group: "Booked by phone", detail: null }, sold: true, revenue: 350 },
    ]);
    expect(rows[0]).toEqual({ group: "Facebook comment", leads: 3, sold: 1, revenue: 650, details: [{ name: "Jace", leads: 2 }, { name: "Max", leads: 1 }] });
    expect(rows[1].group).toBe("Booked by phone");
  });
});

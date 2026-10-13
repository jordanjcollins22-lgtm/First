import { describe, expect, it } from "vitest";

import { adsRowsToSpend, channelOfLeadGroup, channelReport, csvCents, csvDay, lsaLeads, parseSpendCsv, spendBand } from "./spend";

describe("Google Ads rows", () => {
  it("splits Local Services campaigns from Search and turns micros into cents", () => {
    const rows = adsRowsToSpend([
      { segments: { date: "2026-10-01" }, campaign: { id: "1", name: "Search", advertisingChannelType: "SEARCH" }, metrics: { costMicros: "12340000", clicks: "7", impressions: "300", conversions: 1.6 } },
      { segments: { date: "2026-10-01" }, campaign: { id: "2", name: "LSA", advertisingChannelType: "LOCAL_SERVICES" }, metrics: { costMicros: 58530000 } },
      { segments: {}, metrics: { costMicros: 1 } },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ channel: "google_ads", amountCents: 1234, clicks: 7, platformLeads: 2, externalKey: "google_ads:2026-10-01:1" });
    expect(rows[1]).toMatchObject({ channel: "google_lsa", amountCents: 5853 });
  });

  it("reads LSA leads", () => {
    const leads = lsaLeads([
      { localServicesLead: { id: 99, leadType: "PHONE_CALL", leadCharged: true, contactDetails: { phoneNumber: "+14105550100" }, creationDateTime: "2026-10-03 14:22:05" } },
      { localServicesLead: {} },
    ]);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ externalId: "99", charged: true, phone: "+14105550100" });
    expect(leads[0].occurredAt).toMatch(/^2026-10-03T/);
  });
});

describe("CSV", () => {
  it("reads dates and money the ways exports write them", () => {
    expect(csvDay("10/3/2026")).toBe("2026-10-03");
    expect(csvDay("2026-10-03")).toBe("2026-10-03");
    expect(csvDay("nope")).toBeNull();
    expect(csvCents("$1,234.56")).toBe(123456);
    expect(csvCents("--")).toBeNull();
  });

  it("skips Google's title lines, adds up one day's rows and keeps the channel column", () => {
    const csv = [
      "Campaign report",
      "October 1, 2026 - October 3, 2026",
      "Day,Campaign,Cost,Clicks,Conversions",
      '2026-10-01,Lawn,"$10.50",4,1',
      "2026-10-01,Lawn,$2.00,1,0",
      "2026-10-02,Lawn,$5.00,2,0",
      "Total,,$17.50,7,1",
      "bad,,x,,",
    ].join("\n");
    const r = parseSpendCsv(csv, "google_ads");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ channel: "google_ads", day: "2026-10-01", amountCents: 1250, clicks: 5, platformLeads: 1, externalKey: "csv:google_ads:2026-10-01:Lawn" });
    expect(r.problems).toHaveLength(1);
    const typed = parseSpendCsv("date,channel,amount\n10/5/2026,facebook ads,100", "other");
    expect(typed.rows[0]).toMatchObject({ channel: "facebook_ads", amountCents: 10000 });
  });

  it("says so when there is no header to read", () => {
    expect(parseSpendCsv("a,b\n1,2", "google_ads").problems[0]).toMatch(/No header/);
  });
});

describe("channel report", () => {
  const now = new Date("2026-10-13T00:00:00Z");
  it("maps lead groups to what they are paid by", () => {
    expect(channelOfLeadGroup("Google ad")).toBe("google_ads");
    expect(channelOfLeadGroup("Door hangers")).toBe("door_hangers");
    expect(channelOfLeadGroup("Client referral")).toBeNull();
  });

  it("works out cost per lead and per client, and spend against revenue", () => {
    const r = channelReport({
      leads: [
        { group: "Google ad", createdAt: "2026-10-01T00:00:00Z", sold: true, revenue: 1000 },
        { group: "Google ad", createdAt: "2026-10-02T00:00:00Z", sold: false, revenue: 0 },
        { group: "Client referral", createdAt: "2026-10-02T00:00:00Z", sold: true, revenue: 500 },
        { group: "Google ad", createdAt: "2026-01-01T00:00:00Z", sold: true, revenue: 9999 },
      ],
      spend: [
        { channel: "google_ads", day: "2026-10-01", amountCents: 12000 },
        { channel: "google_lsa", day: "2026-10-01", amountCents: 6000 },
      ],
      platformLeads: [{ provider: "google_lsa", occurredAt: "2026-10-04T00:00:00Z" }],
      days: 30,
      now,
      targetLow: 0.05,
      targetHigh: 0.1,
    });
    const ads = r.lines.find((l) => l.channel === "google_ads");
    expect(ads).toMatchObject({ leads: 2, sold: 1, revenueCents: 100000, spendCents: 12000, costPerLeadCents: 6000, cacCents: 12000 });
    expect(r.lines.find((l) => l.channel === "google_lsa")).toMatchObject({ leads: 1, costPerLeadCents: 6000, cacCents: null });
    expect(r.lines.find((l) => l.label === "Client referral")?.costPerLeadCents).toBeNull();
    expect(r.revenueCents).toBe(150000);
    expect(r.spendShare).toBeCloseTo(0.12);
    expect(r.band).toBe("over");
  });

  it("reads the band", () => {
    expect(spendBand(null, 0.05, 0.1)).toBeNull();
    expect(spendBand(0.02, 0.05, 0.1)).toBe("under");
    expect(spendBand(0.07, 0.05, 0.1)).toBe("on");
  });
});

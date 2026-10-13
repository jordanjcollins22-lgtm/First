import { describe, expect, it } from "vitest";

import { agingKey, arAging, dso, lateFeeFor, type LateFeeSettings } from "./ar";
import { addDays, daysBetween, localDay, mondayOf, periodStart } from "./dates";
import { achFeeCents, achSavingsCents, cardFeeCents } from "./fees";
import { divisionOf, dsoBand, isMarketingCharge, isOperatingExpense, marginsByDivision, pct, toneFor, trendTone, BANDS } from "./metrics";
import { adpCsv, csvCell, gustoCsv, GUSTO_HEADER, hoursFromEvents, payrollWeek, splitName } from "./payroll";

describe("dates", () => {
  it("counts the day in Maryland, not UTC", () => {
    // 9pm EDT on Oct 31 is Nov 1 in UTC.
    expect(localDay("2026-11-01T01:00:00Z")).toBe("2026-10-31");
  });
  it("finds Monday and period starts", () => {
    expect(mondayOf("2026-10-13")).toBe("2026-10-12"); // Tuesday
    expect(mondayOf("2026-10-18")).toBe("2026-10-12"); // Sunday
    expect(periodStart("2026-10-13", "month")).toBe("2026-10-01");
    expect(periodStart("2026-10-13", "ytd")).toBe("2026-01-01");
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
  });
});

describe("fees", () => {
  it("caps ACH at $5", () => {
    expect(achFeeCents(200_000)).toBe(500);
    expect(achFeeCents(10_000)).toBe(80);
  });
  it("charges cards 2.9% + 30¢", () => {
    expect(cardFeeCents(200_000)).toBe(5830);
    expect(achSavingsCents(200_000)).toBe(5330);
    expect(cardFeeCents(0)).toBe(0);
  });
});

describe("AR aging", () => {
  const today = "2026-10-13";
  const inv = (id: string, issuedOn: string, amount = 100) => ({ id, customerName: id, amount, issuedOn });
  it("buckets by days past the 30-day due date", () => {
    const a = arAging([inv("a", "2026-10-01"), inv("b", "2026-08-20"), inv("c", "2026-05-01", 50), inv("zero", "2026-01-01", 0)], today);
    expect(a.total).toBe(250);
    expect(a.buckets.find((b) => b.key === "current")?.amount).toBe(100);
    expect(a.buckets.find((b) => b.key === "1-30")?.amount).toBe(100); // due Sep 19, 24 days late
    expect(a.buckets.find((b) => b.key === "90+")?.amount).toBe(50);
    expect(a.rows[0].id).toBe("c"); // latest first
    expect(a.over30).toBe(150);
  });
  it("uses a stated due date over the terms", () => {
    const a = arAging([{ ...inv("a", "2026-10-01"), dueOn: "2026-10-05" }], today);
    expect(a.rows[0].daysLate).toBe(8);
  });
  it("names the boundaries", () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91].map(agingKey)).toEqual(["current", "1-30", "1-30", "31-60", "31-60", "61-90", "61-90", "90+"]);
  });
  it("works out DSO, or nothing over nothing", () => {
    expect(dso(30_000, 90_000, 90)).toBe(30);
    expect(dso(5_000, 0)).toBeNull();
  });
});

describe("late fees", () => {
  const on: LateFeeSettings = { enabled: true, startedAt: "2026-09-01T12:00:00Z", kind: "percent", amount: 1.5, graceDays: 15 };
  const today = "2026-11-20";
  it("is nothing when off", () => {
    expect(lateFeeFor({ amount: 1000, issuedOn: "2026-09-10" }, { ...on, enabled: false }, today)).toBe(0);
  });
  it("never reaches back before it was switched on", () => {
    expect(lateFeeFor({ amount: 1000, issuedOn: "2026-08-10" }, on, today)).toBe(0);
  });
  it("waits out the grace period", () => {
    // Issued Oct 10, due Nov 9, 11 days late on Nov 20: inside 15 days.
    expect(lateFeeFor({ amount: 1000, issuedOn: "2026-10-10" }, on, today)).toBe(0);
    expect(lateFeeFor({ amount: 1000, issuedOn: "2026-09-10" }, on, today)).toBe(15);
  });
  it("can be flat", () => {
    expect(lateFeeFor({ amount: 1000, issuedOn: "2026-09-10" }, { ...on, kind: "flat", amount: 25 }, today)).toBe(25);
  });
});

describe("payroll", () => {
  const weekStart = "2026-10-05";
  const people = [
    { id: "p1", firstName: "Ana", lastName: "Zed", payrollId: "E1" },
    { id: "p2", firstName: "Bo", lastName: "Alba" },
    { id: "p3", firstName: "Cy", lastName: "Nobody" },
  ];
  it("reads a crew day from its first start to its last finish", () => {
    expect(
      hoursFromEvents([
        { profileId: "p", day: "d", kind: "left_shop", at: "2026-10-06T11:00:00Z" },
        { profileId: "p", day: "d", kind: "finished_job", at: "2026-10-06T19:30:00Z" },
        { profileId: "p", day: "d", kind: "returned_shop", at: "2026-10-06T20:00:00Z" },
      ])
    ).toBe(9);
    expect(hoursFromEvents([{ profileId: "p", day: "d", kind: "left_shop", at: "2026-10-06T11:00:00Z" }])).toBeNull();
  });
  it("prefers the clock, falls back to events, and splits overtime past 40", () => {
    const entries = [0, 1, 2, 3].map((i) => ({
      profileId: "p1",
      clockedInAt: `${addDays(weekStart, i)}T11:00:00Z`,
      clockedOutAt: `${addDays(weekStart, i)}T22:00:00Z`, // 11 hours
    }));
    entries.push({ profileId: "p1", clockedInAt: "2026-10-09T11:00:00Z", clockedOutAt: null as unknown as string });
    const events = [
      // Same day as a clocked one: ignored for p1.
      { profileId: "p1", day: "2026-10-05", kind: "left_shop", at: "2026-10-05T10:00:00Z" },
      { profileId: "p1", day: "2026-10-05", kind: "returned_shop", at: "2026-10-05T23:00:00Z" },
      { profileId: "p2", day: "2026-10-07", kind: "arrived_shop", at: "2026-10-07T11:00:00Z" },
      { profileId: "p2", day: "2026-10-07", kind: "returned_shop", at: "2026-10-07T19:00:00Z" },
      // Out of the week.
      { profileId: "p2", day: "2026-10-12", kind: "arrived_shop", at: "2026-10-12T11:00:00Z" },
      { profileId: "p2", day: "2026-10-12", kind: "returned_shop", at: "2026-10-12T19:00:00Z" },
    ];
    const lines = payrollWeek({ weekStart, people, entries, events, commissions: new Map([["p2", 120.5]]) });
    expect(lines.map((l) => l.profileId)).toEqual(["p2", "p1"]); // by last name; nobody with nothing
    const ana = lines.find((l) => l.profileId === "p1")!;
    expect(ana.totalHours).toBe(44);
    expect(ana.regularHours).toBe(40);
    expect(ana.overtimeHours).toBe(4);
    expect(ana.openEntries).toBe(1);
    expect(ana.fromEvents).toBe(0);
    const bo = lines.find((l) => l.profileId === "p2")!;
    expect(bo.totalHours).toBe(8);
    expect(bo.fromEvents).toBe(1);
    expect(bo.commission).toBe(120.5);
    expect(bo.days[2]).toBe(8);
  });
  it("writes Gusto's and ADP's files", () => {
    const lines = payrollWeek({
      weekStart,
      people,
      entries: [{ profileId: "p1", clockedInAt: "2026-10-06T12:00:00Z", clockedOutAt: "2026-10-06T20:00:00Z" }],
      events: [],
      commissions: new Map([["p1", 50]]),
    });
    const g = gustoCsv(lines).split("\r\n");
    expect(g[0]).toBe(GUSTO_HEADER.join(","));
    expect(g[1]).toBe("Zed,Ana,,E1,8.00,,,,,50.00,,,,,");
    const a = adpCsv(lines, { companyCode: "ABC", batchId: "JS261005" }).split("\r\n");
    expect(a[1]).toBe('ABC,JS261005,E1,"Zed, Ana",8.00,,C,50.00');
  });
  it("defuses formulas and quotes commas", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell(-5)).toBe("-5");
  });
  it("splits names", () => {
    expect(splitName("Mary Ann Smith")).toEqual({ firstName: "Mary Ann", lastName: "Smith" });
    expect(splitName(null, "Jo", null)).toEqual({ firstName: "Jo", lastName: "" });
  });
});

describe("metrics", () => {
  it("colours against a band", () => {
    expect(toneFor(7, BANDS.marketingPct)).toBe("good");
    expect(toneFor(12, BANDS.marketingPct)).toBe("warn");
    expect(toneFor(20, BANDS.marketingPct)).toBe("bad");
    expect(toneFor(38, BANDS.laborPct)).toBe("warn");
    expect(toneFor(45, BANDS.laborPct)).toBe("bad");
    expect(toneFor(null, BANDS.laborPct)).toBe("none");
    expect(toneFor(75, BANDS.closeRatePct)).toBe("warn"); // over 70%: test price
  });
  it("uses the owner's DSO target", () => {
    expect(toneFor(40, dsoBand(30))).toBe("warn");
    expect(toneFor(40, dsoBand(45))).toBe("good");
  });
  it("sorts jobs into divisions", () => {
    expect(divisionOf(["Weekly mowing"])).toBe("Maintenance");
    expect(divisionOf(["Patio install", "Mulch"])).toBe("Maintenance");
    expect(divisionOf(["Paver patio"])).toBe("Install");
    expect(divisionOf(["Salt walkway", "Mowing"])).toBe("Snow & ice");
    expect(divisionOf([], "quick_mow")).toBe("Maintenance");
  });
  it("works out margin per division", () => {
    const m = marginsByDivision([
      { division: "Install", price: 1000, labour: 400, materials: 300, other: 0 },
      { division: "Install", price: 1000, labour: 500, materials: 200, other: 50 },
    ]);
    const install = m.find((d) => d.division === "Install")!;
    expect(install.marginPct).toBe(27.5);
    expect(install.tone).toBe("good");
    expect(m.find((d) => d.division === "Snow & ice")!.marginPct).toBeNull();
  });
  it("spots marketing charges and leaves transfers out of expenses", () => {
    expect(isMarketingCharge("FACEBK *ADS Facebook")).toBe(true);
    expect(isMarketingCharge("GOOGLE *ADS1234")).toBe(true);
    expect(isMarketingCharge("Home Depot")).toBe(false);
    expect(isMarketingCharge("Exchanging tires")).toBe(false);
    expect(isOperatingExpense("TRANSFER_OUT")).toBe(false);
    expect(isOperatingExpense("GENERAL_SERVICES")).toBe(true);
  });
  it("judges a trend and a share", () => {
    expect(trendTone(100, 90)).toBe("good");
    expect(trendTone(70, 90)).toBe("warn");
    expect(trendTone(10, 90)).toBe("bad");
    expect(trendTone(10, 0)).toBe("none");
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(1, 0)).toBeNull();
  });
});

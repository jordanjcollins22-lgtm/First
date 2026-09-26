import { describe, expect, it } from "vitest";

import {
  dayKeyIn,
  describeNotice,
  describeNoticeForOffice,
  firstBookableDate,
  minLeadMinutes,
  parseNoticeHours,
  tooSoon,
  type BookingNotice,
} from "@/lib/booking-notice";

const ET = "America/New_York";
const noSameDay: BookingNotice = { noticeHours: 0, sameDay: false, timeZone: ET };

describe("dayKeyIn", () => {
  it("answers on the business's clock, not the server's", () => {
    // 11pm Eastern on the 12th is 3am UTC on the 13th.
    const late = new Date("2026-09-13T03:00:00Z");
    expect(dayKeyIn(late, ET)).toBe("2026-09-12");
    expect(dayKeyIn(late, "UTC")).toBe("2026-09-13");
  });
});

describe("firstBookableDate", () => {
  it("is tomorrow when same day is off, even late at night on the business's clock", () => {
    expect(firstBookableDate(noSameDay, new Date("2026-09-13T03:00:00Z"))).toBe("2026-09-13");
    expect(firstBookableDate(noSameDay, new Date("2026-09-12T15:00:00Z"))).toBe("2026-09-13");
  });

  it("is today when same day is allowed", () => {
    expect(firstBookableDate({ ...noSameDay, sameDay: true }, new Date("2026-09-12T15:00:00Z"))).toBe("2026-09-12");
  });

  it("lets hours of notice push the first day later than the same-day rule", () => {
    // 10am Monday Eastern plus 48 hours is Wednesday.
    const monday = new Date("2026-09-14T14:00:00Z");
    expect(firstBookableDate({ ...noSameDay, noticeHours: 48 }, monday)).toBe("2026-09-16");
    expect(firstBookableDate({ ...noSameDay, sameDay: true, noticeHours: 48 }, monday)).toBe("2026-09-16");
  });
});

describe("tooSoon", () => {
  const now = new Date("2026-09-12T15:00:00Z"); // 11am Eastern

  it("refuses today when same day is off", () => {
    expect(tooSoon(noSameDay, now, { date: "2026-09-12", at: new Date("2026-09-12T18:00:00Z") })).toMatch(/same day/);
  });

  it("accepts tomorrow", () => {
    expect(tooSoon(noSameDay, now, { date: "2026-09-13", at: new Date("2026-09-13T13:00:00Z") })).toBeNull();
  });

  it("insists on the hours of notice even on an allowed day", () => {
    const rule = { ...noSameDay, sameDay: true, noticeHours: 4 };
    expect(tooSoon(rule, now, { date: "2026-09-12", at: new Date("2026-09-12T17:00:00Z") })).toMatch(/4 hours notice/);
    expect(tooSoon(rule, now, { date: "2026-09-12", at: new Date("2026-09-12T20:00:00Z") })).toBeNull();
  });
});

describe("wording", () => {
  it("keeps the hour of lead the slot search always had", () => {
    expect(minLeadMinutes(noSameDay)).toBe(60);
    expect(minLeadMinutes({ ...noSameDay, noticeHours: 24 })).toBe(1440);
  });

  it("says the rule the way a client reads it", () => {
    expect(describeNotice(noSameDay)).toBe("The earliest visit is tomorrow.");
    expect(describeNotice({ ...noSameDay, noticeHours: 48 })).toBe("The earliest visit is tomorrow and at least 2 days after you book.");
    expect(describeNotice({ ...noSameDay, sameDay: true, noticeHours: 4 })).toBe("Visits need at least 4 hours notice.");
    expect(describeNotice({ ...noSameDay, sameDay: true })).toBe("");
  });

  it("says the rule the way the office reads it", () => {
    expect(describeNoticeForOffice({ ...noSameDay, noticeHours: 24 })).toBe(
      "Same-day visits are never offered, and nothing inside 24 hours of booking. Days are judged on America/New York time."
    );
  });

  it("accepts sensible hours and refuses the rest", () => {
    expect(parseNoticeHours("24")).toBe(24);
    expect(parseNoticeHours("")).toBe(0);
    expect(parseNoticeHours("-1")).toBeNull();
    expect(parseNoticeHours("9999")).toBeNull();
  });
});

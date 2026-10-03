import { describe, expect, it } from "vitest";

import {
  bookingWarning,
  easterSunday,
  holidaysBetween,
  holidaysInYear,
  holidaysOn,
  isClosedDay,
} from "@/lib/holidays";

function dateOf(year: number, name: string): string | undefined {
  return holidaysInYear(year).find((holiday) => holiday.name === name)?.date;
}

function observedOf(year: number, name: string): string | undefined {
  return holidaysInYear(year).find((holiday) => holiday.name === name)?.observed;
}

describe("the fixed-date holidays", () => {
  it.each([
    ["New Year's Day", "2026-01-01"],
    ["Juneteenth", "2026-06-19"],
    ["Independence Day", "2026-07-04"],
    ["Veterans Day", "2026-11-11"],
    ["Christmas Eve", "2026-12-24"],
    ["Christmas Day", "2026-12-25"],
    ["Halloween", "2026-10-31"],
    ["New Year's Eve", "2026-12-31"],
  ])("puts %s on %s", (name, expected) => {
    expect(dateOf(2026, name)).toBe(expected);
  });
});

describe("the ones that move", () => {
  it.each([
    ["Martin Luther King Jr. Day", "2026-01-19"],
    ["Presidents' Day", "2026-02-16"],
    ["Memorial Day", "2026-05-25"],
    ["Labor Day", "2026-09-07"],
    ["Columbus Day", "2026-10-12"],
    ["Thanksgiving", "2026-11-26"],
    ["Mother's Day", "2026-05-10"],
  ])("works out %s as %s in 2026", (name, expected) => {
    expect(dateOf(2026, name)).toBe(expected);
  });

  it("puts the day after Thanksgiving the day after Thanksgiving", () => {
    expect(dateOf(2026, "Day after Thanksgiving")).toBe("2026-11-27");
  });

  it("keeps working in years nobody has checked by hand", () => {
    // The whole reason these are rules and not a list.
    expect(dateOf(2030, "Labor Day")).toBe("2030-09-02");
    expect(dateOf(2031, "Thanksgiving")).toBe("2031-11-27");
  });
});

describe("easterSunday", () => {
  it.each([
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
  ])("finds Easter %i", (year, expected) => {
    expect(easterSunday(year)).toBe(expected);
  });

  it("puts Good Friday two days before Easter", () => {
    expect(dateOf(2026, "Good Friday")).toBe("2026-04-03");
  });
});

describe("moving a federal holiday off a weekend", () => {
  it("takes the Friday when the Fourth is a Saturday", () => {
    // 4 July 2026 is a Saturday.
    expect(dateOf(2026, "Independence Day")).toBe("2026-07-04");
    expect(observedOf(2026, "Independence Day")).toBe("2026-07-03");
  });

  it("takes the Monday when the Fourth is a Sunday", () => {
    // 4 July 2027 is a Sunday.
    expect(observedOf(2027, "Independence Day")).toBe("2027-07-05");
  });

  it("leaves a weekday holiday where it is", () => {
    expect(observedOf(2026, "Christmas Day")).toBe("2026-12-25");
  });

  it("does not move an observance, because Mother's Day is a Sunday by definition", () => {
    expect(observedOf(2026, "Mother's Day")).toBe(dateOf(2026, "Mother's Day"));
  });
});

describe("holidaysOn", () => {
  it("finds the holiday on its own date", () => {
    expect(holidaysOn("2026-09-07").map((h) => h.name)).toEqual(["Labor Day"]);
  });

  it("finds a holiday by the day it is observed", () => {
    // Nobody is in on Friday the third, which is the day being booked.
    expect(holidaysOn("2026-07-03").map((h) => h.name)).toEqual(["Independence Day"]);
  });

  it("finds a day off that belongs to the year before the holiday", () => {
    // 1 January 2028 is a Saturday, so the day off is 31 December 2027.
    const found = holidaysOn("2027-12-31");
    expect(found.map((h) => h.name)).toContain("New Year's Day");
  });

  it("finds nothing on an ordinary Tuesday", () => {
    expect(holidaysOn("2026-09-08")).toEqual([]);
  });

  it("survives a date it cannot read", () => {
    expect(holidaysOn("not-a-date")).toEqual([]);
  });
});

describe("isClosedDay", () => {
  it("is true on Labor Day, which is the point of all this", () => {
    expect(isClosedDay("2026-09-07")).toBe(true);
  });

  it("is true on the observed day rather than the holiday itself", () => {
    expect(isClosedDay("2026-07-03")).toBe(true);
  });

  it("is false on Mother's Day, which the business may well work", () => {
    expect(isClosedDay("2026-05-10")).toBe(false);
  });

  it("is false on an ordinary day", () => {
    expect(isClosedDay("2026-09-08")).toBe(false);
  });
});

describe("bookingWarning", () => {
  it("names the holiday rather than saying a holiday", () => {
    expect(bookingWarning("2026-09-07")).toBe("Labor Day. Nobody is working.");
  });

  it("explains why the crew are off on a day that is not the holiday", () => {
    expect(bookingWarning("2026-07-03")).toBe(
      "Independence Day is observed on this day. Nobody is working."
    );
  });

  it("is softer for a day the business may choose to work", () => {
    expect(bookingWarning("2026-05-10")).toBe(
      "Mother's Day. Worth checking before booking a crew."
    );
  });

  it("says nothing about an ordinary day", () => {
    expect(bookingWarning("2026-09-08")).toBeNull();
  });

  it("leads with the closure when a day is both", () => {
    // Christmas Eve is an observance; Christmas Day is not. A day carrying
    // both must not be softened into "worth checking".
    const warning = bookingWarning("2026-12-25");
    expect(warning).toContain("Nobody is working");
  });
});

describe("holidaysBetween", () => {
  it("finds a holiday inside a week, not just on its first day", () => {
    // Booked Monday to Friday over Thanksgiving.
    const found = holidaysBetween("2026-11-23", "2026-11-27");
    expect(found.map((h) => h.name)).toEqual(["Thanksgiving", "Day after Thanksgiving"]);
  });

  it("includes both ends", () => {
    expect(holidaysBetween("2026-09-07", "2026-09-07").map((h) => h.name)).toEqual(["Labor Day"]);
  });

  it("matches the observed day, so a shifted day off is caught", () => {
    // The Fourth is the Saturday; the day off inside this range is the Friday.
    expect(holidaysBetween("2026-06-29", "2026-07-03").map((h) => h.name)).toEqual([
      "Independence Day",
    ]);
  });

  it("spans a year end", () => {
    const names = holidaysBetween("2026-12-24", "2027-01-01").map((h) => h.name);
    expect(names).toContain("Christmas Day");
    expect(names).toContain("New Year's Day");
  });

  it("finds nothing in an ordinary week", () => {
    expect(holidaysBetween("2026-09-08", "2026-09-11")).toEqual([]);
  });

  it("treats a backwards range as no range, because that is somebody mid-edit", () => {
    expect(holidaysBetween("2026-11-27", "2026-11-23")).toEqual([]);
  });

  it("survives a missing end date", () => {
    expect(holidaysBetween("2026-11-23", "")).toEqual([]);
  });
});

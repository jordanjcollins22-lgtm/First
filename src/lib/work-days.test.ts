import { describe, expect, it } from "vitest";

import {
  buildWorkDays,
  dayLabel,
  daysBetween,
  firstOpenDay,
  openDays,
  rainBlocks,
  weatherIsKnown,
  windowNote,
  WEATHER_WINDOW_DAYS,
} from "./work-days";

const TODAY = "2026-09-07"; // a Monday

function wet(date: string, precipChance = 80, code = 63) {
  return { date, precipChance, code, label: "Rain" };
}

describe("dayLabel", () => {
  it("reads back the day that was asked for, not the one before", () => {
    // A bare date string parsed in a negative timezone is the previous day,
    // which is how a client picks Tuesday and the crew turns up on Monday.
    expect(dayLabel("2026-09-08")).toBe("Tue, Sep 8");
    expect(dayLabel("2026-01-01")).toBe("Thu, Jan 1");
  });
});

describe("daysBetween", () => {
  it("counts forwards and backwards", () => {
    expect(daysBetween("2026-09-07", "2026-09-14")).toBe(7);
    expect(daysBetween("2026-09-14", "2026-09-07")).toBe(-7);
    expect(daysBetween("2026-09-07", "2026-09-07")).toBe(0);
  });

  it("counts across a month and a year end", () => {
    expect(daysBetween("2026-01-31", "2026-02-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });
});

describe("weatherIsKnown", () => {
  it("stops at the forecast horizon", () => {
    expect(weatherIsKnown(TODAY, TODAY)).toBe(true);
    expect(weatherIsKnown(TODAY, "2026-09-20")).toBe(true); // day 13
    expect(weatherIsKnown(TODAY, "2026-09-21")).toBe(false); // day 14
  });

  it("knows nothing about the past", () => {
    expect(weatherIsKnown(TODAY, "2026-09-06")).toBe(false);
  });
});

describe("rainBlocks", () => {
  it("blocks on a real chance of rain", () => {
    expect(rainBlocks(wet("x", 80))).toBe(true);
    expect(rainBlocks(wet("x", 50))).toBe(true);
    expect(rainBlocks(wet("x", 30))).toBe(false);
  });

  it("blocks thunder and snow whatever the chance", () => {
    // Nobody runs equipment through a thunderstorm because it was only
    // twenty percent likely.
    expect(rainBlocks({ date: "x", precipChance: 20, code: 95, label: "Storm" })).toBe(true);
    expect(rainBlocks({ date: "x", precipChance: 10, code: 73, label: "Snow" })).toBe(true);
  });
});

describe("buildWorkDays", () => {
  it("offers working days only", () => {
    const days = buildWorkDays({ today: TODAY, days: 7 });
    expect(days.map((d) => d.date)).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      // Sunday the 13th is missing.
    ]);
  });

  it("honours a different working week", () => {
    const days = buildWorkDays({ today: TODAY, days: 7, workingDays: [1, 3, 5] });
    expect(days.map((d) => d.date)).toEqual(["2026-09-07", "2026-09-09", "2026-09-11"]);
  });

  it("never offers a day before the earliest we will start", () => {
    // The payment plan that protects a discount books a month out, so next
    // Tuesday is not on offer however much they want it.
    const days = buildWorkDays({ today: TODAY, earliest: "2026-10-05", days: 3 });
    expect(days[0].date).toBe("2026-10-05");
  });

  it("ignores an earliest that has already passed", () => {
    const days = buildWorkDays({ today: TODAY, earliest: "2026-08-01", days: 2 });
    expect(days[0].date).toBe(TODAY);
  });

  it("blocks a day the forecast has given up on", () => {
    const days = buildWorkDays({ today: TODAY, days: 3, weather: [wet("2026-09-08")] });
    const tuesday = days.find((d) => d.date === "2026-09-08")!;
    expect(tuesday.status).toBe("rain");
    expect(tuesday.reason).toBe("Blocked off, rain likely");
    expect(tuesday.precipChance).toBe(80);
  });

  it("shows the forecast on days that are still fine", () => {
    const days = buildWorkDays({
      today: TODAY,
      days: 2,
      weather: [{ date: TODAY, precipChance: 10, code: 1, label: "Mostly clear" }],
    });
    expect(days[0].status).toBe("open");
    expect(days[0].weatherLabel).toBe("Mostly clear");
    expect(days[0].precipChance).toBe(10);
  });

  it("says nothing about weather past the horizon", () => {
    // A forecast row can arrive for a day we would not repeat to a client.
    const far = "2026-09-28";
    const days = buildWorkDays({ today: TODAY, days: 30, weather: [wet(far)] });
    const day = days.find((d) => d.date === far)!;
    expect(day.status).toBe("open");
    expect(day.weatherLabel).toBeNull();
    expect(day.precipChance).toBeNull();
  });

  it("closes a day the crew is already committed to", () => {
    const days = buildWorkDays({
      today: TODAY,
      days: 3,
      capacityPerDay: 2,
      booked: ["2026-09-08", "2026-09-08"],
    });
    const tuesday = days.find((d) => d.date === "2026-09-08")!;
    expect(tuesday.status).toBe("full");
    expect(tuesday.reason).toBe("Fully booked");
  });

  it("leaves a day with room on it open", () => {
    const days = buildWorkDays({ today: TODAY, days: 3, capacityPerDay: 2, booked: ["2026-09-08"] });
    expect(days.find((d) => d.date === "2026-09-08")!.status).toBe("open");
  });

  it("calls a full day full even when it is also raining", () => {
    // Both are true and only one can be said, so say the one that will not
    // change: rain lifts, a booked crew does not.
    const days = buildWorkDays({
      today: TODAY,
      days: 3,
      capacityPerDay: 1,
      booked: ["2026-09-08"],
      weather: [wet("2026-09-08")],
    });
    expect(days.find((d) => d.date === "2026-09-08")!.status).toBe("full");
  });
});

describe("firstOpenDay", () => {
  it("is the soonest day they can actually have", () => {
    const days = buildWorkDays({
      today: TODAY,
      days: 5,
      weather: [wet(TODAY), wet("2026-09-08")],
    });
    expect(firstOpenDay(days)!.date).toBe("2026-09-09");
  });

  it("is null when nothing is open", () => {
    const days = buildWorkDays({ today: TODAY, days: 1, weather: [wet(TODAY)] });
    expect(openDays(days)).toHaveLength(0);
    expect(firstOpenDay(days)).toBeNull();
  });
});

describe("windowNote", () => {
  it("says nothing about rain when nothing is blocked", () => {
    const note = windowNote(buildWorkDays({ today: TODAY, days: 3 }));
    expect(note).not.toMatch(/rain/i);
  });

  it("explains the blocked days rather than leaving them a mystery", () => {
    const note = windowNote(buildWorkDays({ today: TODAY, days: 3, weather: [wet("2026-09-08")] }));
    expect(note).toMatch(/One day is blocked off/);
    expect(note).toMatch(/open them back up/);
  });

  it("counts more than one", () => {
    const note = windowNote(
      buildWorkDays({ today: TODAY, days: 4, weather: [wet("2026-09-08"), wet("2026-09-09")] })
    );
    expect(note).toMatch(/2 days are blocked off/);
  });

  it("uses no dashes", () => {
    expect(windowNote(buildWorkDays({ today: TODAY, days: 3, weather: [wet("2026-09-08")] })))
      .not.toMatch(/[—–]/);
  });
});

describe("the horizon itself", () => {
  it("is two weeks, which is what the client is told", () => {
    expect(WEATHER_WINDOW_DAYS).toBe(14);
  });
});

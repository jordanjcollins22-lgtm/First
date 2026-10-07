import { describe, expect, it } from "vitest";

import { daysNotWorked, describeDayNotWorked } from "./crew-availability";

const weekdays = [1, 2, 3, 4, 5].map((day_of_week) => ({ day_of_week }));

describe("daysNotWorked", () => {
  it("finds a Saturday in a weekday worker's booking", () => {
    // Fri 25 Sep to Mon 28 Sep 2026.
    expect(daysNotWorked(weekdays, "2026-09-25", "2026-09-28")).toEqual(["2026-09-26", "2026-09-27"]);
  });
  it("is nothing on days they work", () => {
    expect(daysNotWorked(weekdays, "2026-10-07", "2026-10-07")).toEqual([]);
  });
  it("takes somebody with no hours set as available every day", () => {
    expect(daysNotWorked([], "2026-09-26", "2026-09-27")).toEqual([]);
  });
  it("says which day, by name", () => {
    expect(describeDayNotWorked("Max", "2026-09-26")).toMatch(/^Max doesn't work Saturdays\./);
  });
});

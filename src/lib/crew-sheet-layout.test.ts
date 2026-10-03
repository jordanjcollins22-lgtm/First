import { describe, expect, it } from "vitest";

import { usesPreviousCrewSheet } from "./crew-sheet-layout";

describe("which crew sheet a job gets", () => {
  it("keeps the old sheet for a job out today, or started before the change", () => {
    expect(usesPreviousCrewSheet({ firstWorkDay: "2026-09-29", firstWorkAt: "2026-09-29T13:10:06Z" })).toBe(true);
    expect(usesPreviousCrewSheet({ firstWorkDay: "2026-09-28", firstWorkAt: null })).toBe(true);
    // Worked without a day on the calendar, before the change.
    expect(usesPreviousCrewSheet({ firstWorkDay: null, firstWorkAt: "2026-09-29T15:00:00Z" })).toBe(true);
  });

  it("gives the new sheet to a job whose work starts after it", () => {
    expect(usesPreviousCrewSheet({ firstWorkDay: "2026-10-07", firstWorkAt: null })).toBe(false);
    // Its first tap, on the day, does not send it back to the old sheet.
    expect(usesPreviousCrewSheet({ firstWorkDay: "2026-10-07", firstWorkAt: "2026-10-07T12:00:00Z" })).toBe(false);
    expect(usesPreviousCrewSheet({ firstWorkDay: null, firstWorkAt: null })).toBe(false);
  });
});

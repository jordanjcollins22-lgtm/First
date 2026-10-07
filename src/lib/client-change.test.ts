import { describe, expect, it } from "vitest";

import { cancelNote, movedEvaluation, movedVisit } from "./client-change";

const now = new Date("2026-09-30T15:00:00Z"); // 11:00 AM in Bel Air

describe("moving an evaluation", () => {
  it("keeps the length it was booked for", () => {
    const moved = movedEvaluation({ start: "2026-09-30T18:00:00Z", end: "2026-09-30T18:30:00Z" }, "2026-10-02", "10:00", now);
    expect(moved).toEqual({ ok: true, value: { start: "2026-10-02T14:00:00.000Z", end: "2026-10-02T14:30:00.000Z" } });
  });

  it("books an hour when it had no end", () => {
    const moved = movedEvaluation({ start: "2026-09-30T18:00:00Z", end: null }, "2026-10-02", "13:30", now);
    expect(moved.ok && moved.value.end).toBe("2026-10-02T18:30:00.000Z");
  });

  it("won't move it into the past, or to no time at all", () => {
    expect(movedEvaluation({ start: "2026-09-30T18:00:00Z", end: null }, "2026-09-30", "09:00", now)).toMatchObject({ ok: false });
    expect(movedEvaluation({ start: "2026-09-30T18:00:00Z", end: null }, "", "", now)).toMatchObject({ ok: false, reason: "Pick the new day and time." });
  });
});

describe("moving a work visit", () => {
  it("keeps how many days it runs", () => {
    expect(movedVisit({ startsOn: "2026-09-30", endsOn: "2026-09-30" }, "2026-10-05", now)).toEqual({ ok: true, value: { startsOn: "2026-10-05", endsOn: "2026-10-05" } });
    expect(movedVisit({ startsOn: "2026-09-29", endsOn: "2026-09-30" }, "2026-10-05", now)).toEqual({ ok: true, value: { startsOn: "2026-10-05", endsOn: "2026-10-06" } });
  });

  it("allows later today but not a day gone", () => {
    expect(movedVisit({ startsOn: "2026-09-30", endsOn: "2026-09-30" }, "2026-09-30", now).ok).toBe(true);
    expect(movedVisit({ startsOn: "2026-09-30", endsOn: "2026-09-30" }, "2026-09-29", now)).toMatchObject({ ok: false });
  });
});

describe("calling it off", () => {
  it("needs a reason, and keeps it in the client's words", () => {
    expect(cancelNote("  ")).toMatchObject({ ok: false });
    expect(cancelNote("Rain all week, wants to wait")).toEqual({ ok: true, value: "Client called it off: Rain all week, wants to wait" });
  });
});

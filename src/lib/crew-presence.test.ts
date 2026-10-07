import { describe, expect, it } from "vitest";

import { presenceOf, quietLine } from "./crew-presence";

const day = "2026-09-17";
const nineAm = new Date("2026-09-17T13:00:00Z");
const sevenAm = new Date("2026-09-17T11:00:00Z");

describe("presenceOf", () => {
  it("is quiet when nothing has come from them after the cut-off", () => {
    const p = presenceOf({ day, eventsToday: 0, checksToday: 0, positionAt: "2026-09-16T12:46:00Z" }, nineAm);
    expect(p.seenToday).toBe(false);
    expect(p.quiet).toBe(true);
    expect(p.lastSeenAt).toBe("2026-09-16T12:46:00Z");
  });

  it("does not chase anybody before the trucks leave", () => {
    expect(presenceOf({ day, eventsToday: 0, checksToday: 0, positionAt: null }, sevenAm).quiet).toBe(false);
  });

  it("counts a tap, a tick or a position today as seen", () => {
    expect(presenceOf({ day, eventsToday: 1, checksToday: 0, positionAt: null }, nineAm).seenToday).toBe(true);
    expect(presenceOf({ day, eventsToday: 0, checksToday: 2, positionAt: null }, nineAm).seenToday).toBe(true);
    expect(presenceOf({ day, eventsToday: 0, checksToday: 0, positionAt: "2026-09-17T11:30:00Z" }, nineAm).seenToday).toBe(true);
  });

  it("never flags a day that is not today", () => {
    expect(presenceOf({ day: "2026-09-16", eventsToday: 0, checksToday: 0, positionAt: null }, nineAm).quiet).toBe(false);
  });
});

describe("quietLine", () => {
  it("names them and where they should be", () => {
    expect(quietLine("Shalon", "Matthew Schautz")).toBe("Shalon hasn't opened the app today. First stop: Matthew Schautz.");
    expect(quietLine("Shalon", null)).toBe("Shalon hasn't opened the app today.");
  });
});

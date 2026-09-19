import { describe, expect, it } from "vitest";

import { describeWindow, hourIn, isQuiet, nextAllowed, QUIET_DEFAULTS } from "@/lib/quiet-hours";

const MARYLAND: { startHour: number; endHour: number; timeZone: string } = {
  ...QUIET_DEFAULTS,
  timeZone: "America/New_York",
};

describe("what time it is where the client is", () => {
  it("reads the client's clock, not the server's", () => {
    // Noon UTC in January is seven in the morning in Maryland, which is the
    // whole reason this is not a comparison against getUTCHours.
    expect(hourIn(new Date("2026-01-15T12:00:00Z"), "America/New_York")).toBe(7);
  });

  it("follows the clocks changing rather than a stored offset", () => {
    // The same UTC hour, either side of daylight saving.
    expect(hourIn(new Date("2026-01-15T12:00:00Z"), "America/New_York")).toBe(7);
    expect(hourIn(new Date("2026-07-15T12:00:00Z"), "America/New_York")).toBe(8);
  });

  it("reads midnight as zero", () => {
    expect(hourIn(new Date("2026-01-15T05:00:00Z"), "America/New_York")).toBe(0);
  });

  it("falls back rather than refusing when the zone is nonsense", () => {
    // A settings mistake should not mean nothing is ever sent again.
    expect(hourIn(new Date("2026-01-15T12:00:00Z"), "Not/AZone")).toBe(12);
  });
});

describe("whether a moment is too early or too late to text somebody", () => {
  it("says yes at half past six in the morning", () => {
    expect(isQuiet(new Date("2026-01-15T11:30:00Z"), MARYLAND)).toBe(true);
  });

  it("says no in the middle of the afternoon", () => {
    expect(isQuiet(new Date("2026-01-15T19:00:00Z"), MARYLAND)).toBe(false);
  });

  it("opens on the hour it says and closes on the hour it says", () => {
    // 8am local is in; 9pm local is out.
    expect(isQuiet(new Date("2026-01-15T13:00:00Z"), MARYLAND)).toBe(false);
    expect(isQuiet(new Date("2026-01-16T02:00:00Z"), MARYLAND)).toBe(true);
  });

  it("reads a window that wraps past midnight", () => {
    const nightShift = { startHour: 22, endHour: 6, timeZone: "UTC" };
    expect(isQuiet(new Date("2026-01-15T23:00:00Z"), nightShift)).toBe(false);
    expect(isQuiet(new Date("2026-01-15T12:00:00Z"), nightShift)).toBe(true);
  });
});

describe("when a held message may actually go", () => {
  it("leaves a message alone when the window is already open", () => {
    const at = new Date("2026-01-15T19:00:00Z");
    expect(nextAllowed(at, MARYLAND)).toBe(at);
  });

  it("holds an early-morning one until the window opens", () => {
    // Half past four in the morning in Maryland, out until eight.
    const held = nextAllowed(new Date("2026-01-15T09:30:00Z"), MARYLAND);
    expect(hourIn(held, MARYLAND.timeZone)).toBe(8);
    expect(isQuiet(held, MARYLAND)).toBe(false);
  });

  it("holds a late-night one until the next morning", () => {
    const held = nextAllowed(new Date("2026-01-16T04:00:00Z"), MARYLAND);
    expect(hourIn(held, MARYLAND.timeZone)).toBe(8);
    // The next morning, not the same evening it was already too late for.
    expect(held.getTime()).toBeGreaterThan(new Date("2026-01-16T04:00:00Z").getTime());
  });

  it("never moves a message backwards", () => {
    for (const iso of ["2026-01-15T03:00:00Z", "2026-01-15T13:00:00Z", "2026-07-04T23:00:00Z"]) {
      const at = new Date(iso);
      expect(nextAllowed(at, MARYLAND).getTime()).toBeGreaterThanOrEqual(at.getTime());
    }
  });

  it("always lands somewhere the window is open", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const at = new Date(Date.UTC(2026, 2, 10, hour));
      expect(isQuiet(nextAllowed(at, MARYLAND), MARYLAND)).toBe(false);
    }
  });
});

describe("how the window reads on a settings screen", () => {
  it("says it in hours a person uses", () => {
    expect(describeWindow(MARYLAND)).toContain("8am to 9pm");
    expect(describeWindow(MARYLAND)).toContain("New York");
  });
});

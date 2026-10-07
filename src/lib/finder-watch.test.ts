import { describe, expect, it } from "vitest";

import { finderAlert, minutesIntoHours, type FinderWatchInput } from "./finder-watch";

const now = new Date("2026-09-30T15:00:00Z"); // 11:00 AM in Bel Air
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
const input = (extra: Partial<FinderWatchInput> = {}): FinderWatchInput => ({
  now,
  shouldRun: true,
  minutesRunning: 180,
  extensionSeenAt: ago(1),
  lastLookAt: ago(2),
  matchedToday: 3,
  linkedToday: 2,
  today: "2026-09-30",
  timeZone: "America/New_York",
  ...extra,
});

describe("the post finder watch", () => {
  it("says nothing while it is checking in and reading", () => {
    expect(finderAlert(input())).toBeNull();
  });

  it("says the laptop stopped when it hasn't checked in for twenty minutes", () => {
    const alert = finderAlert(input({ extensionSeenAt: ago(42), lastLookAt: ago(43) }));
    expect(alert?.problem).toBe("not_running");
    expect(alert?.text).toBe(
      "The post finder has stopped: the laptop hasn't checked in since 10:18 AM. Check the laptop is awake and plugged in, Chrome is open, and the finder window is on screen, not minimized."
    );
    expect(finderAlert(input({ extensionSeenAt: ago(19), lastLookAt: ago(19) }))).toBeNull();
  });

  it("keys each stop once, so one stop is one message", () => {
    const first = finderAlert(input({ extensionSeenAt: ago(25) }));
    const later = finderAlert(input({ now: new Date(now.getTime() + 30 * 60_000), extensionSeenAt: ago(25) }));
    expect(first?.dedupeKey).toBe(later?.dedupeKey);
  });

  it("says it isn't reading when Chrome checks in but no look has come back", () => {
    const alert = finderAlert(input({ lastLookAt: ago(35) }));
    expect(alert?.problem).toBe("not_reading");
    expect(alert?.text).toContain("hasn't read Facebook since 10:25 AM");
  });

  it("says the links are broken after a day's worth of posts with none", () => {
    expect(finderAlert(input({ matchedToday: 9, linkedToday: 0 }))?.problem).toBe("no_links");
    expect(finderAlert(input({ matchedToday: 9, linkedToday: 1 }))).toBeNull();
    expect(finderAlert(input({ matchedToday: 7, linkedToday: 0 }))).toBeNull();
  });

  it("stays quiet when it is switched off, outside hours, or only just started", () => {
    const dead = { extensionSeenAt: ago(300), lastLookAt: ago(300) };
    expect(finderAlert(input({ ...dead, shouldRun: false }))).toBeNull();
    expect(finderAlert(input({ ...dead, minutesRunning: 10 }))).toBeNull();
    expect(finderAlert(input({ ...dead, minutesRunning: 20 }))?.problem).toBe("not_running");
  });

  it("counts minutes into the looking hours by the business's clock", () => {
    expect(minutesIntoHours("08:15", "08:00")).toBe(15);
    expect(minutesIntoHours("07:50", "08:00")).toBe(1430);
  });
});

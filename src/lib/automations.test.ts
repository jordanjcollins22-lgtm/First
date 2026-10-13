import { describe, expect, it } from "vitest";

import { evaluationStepsToGo, localDay, offsetsToGo, zonedTime } from "@/lib/automations";

const TZ = "America/New_York";

describe("zonedTime", () => {
  it("reads a wall-clock time in the business's zone", () => {
    expect(zonedTime("2026-10-14", 9, 0, TZ).toISOString()).toBe("2026-10-14T13:00:00.000Z");
    expect(zonedTime("2026-12-14", 9, 0, TZ).toISOString()).toBe("2026-12-14T14:00:00.000Z");
  });
  it("finds the local day", () => {
    expect(localDay(new Date("2026-10-15T02:00:00Z"), TZ)).toBe("2026-10-14");
  });
});

describe("evaluationStepsToGo", () => {
  const evaluationAt = new Date("2026-10-20T14:00:00Z"); // 10am on the 20th
  const bookedAt = new Date("2026-10-10T15:00:00Z");
  const base = { evaluationAt, bookedAt, timeZone: TZ, sent: new Set<never>(), disabled: new Set<never>() };

  it("lists every step still to go, earliest first", () => {
    const steps = evaluationStepsToGo({ ...base, now: new Date("2026-10-13T12:00:00Z"), sent: new Set(["booked"] as const) });
    expect(steps.map((s) => s.step)).toEqual(["two_days", "day_before", "morning_of", "after"]);
    expect(steps[0].at.toISOString()).toBe("2026-10-18T13:00:00.000Z");
  });

  it("drops steps already sent, switched off, or past their window", () => {
    const steps = evaluationStepsToGo({
      ...base,
      now: new Date("2026-10-19T22:00:00Z"), // 6pm the day before: inside its window
      sent: new Set(["booked", "two_days"] as const),
      disabled: new Set(["after"] as const),
    });
    expect(steps.map((s) => s.step)).toEqual(["day_before", "morning_of"]);
  });

  it("skips reminders that were due before the visit was booked", () => {
    const steps = evaluationStepsToGo({ ...base, bookedAt: new Date("2026-10-19T23:00:00Z"), now: new Date("2026-10-19T23:30:00Z") });
    expect(steps.map((s) => s.step)).toEqual(["booked", "morning_of", "after"]);
  });

  it("is empty once the thank-you window has closed", () => {
    expect(evaluationStepsToGo({ ...base, now: new Date("2026-10-21T14:00:00Z") })).toEqual([]);
  });
});

describe("offsetsToGo", () => {
  const sentAt = new Date("2026-10-01T12:00:00Z");
  it("keeps follow-ups not yet sent and not more than a day late", () => {
    const now = new Date("2026-10-05T13:00:00Z"); // 97h after: the 72h one is a day late
    expect(offsetsToGo(sentAt, [72, 168], now, new Set()).map((o) => o.offset)).toEqual([168]);
    expect(offsetsToGo(sentAt, [72, 168], new Date("2026-10-02T00:00:00Z"), new Set([72])).map((o) => o.offset)).toEqual([168]);
  });
});

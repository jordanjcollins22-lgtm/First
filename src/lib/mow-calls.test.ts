import { describe, expect, it } from "vitest";

import { callClock, calledInTime } from "@/lib/mow-calls";

const now = new Date("2026-10-02T18:00:00Z");
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

describe("speed to lead", () => {
  it("says call now inside the two minutes", () => {
    expect(callClock(ago(0.5), now)).toMatchObject({ overdue: false, label: "Call now" });
    expect(callClock(ago(2), now)).toMatchObject({ overdue: false, label: "Call now" });
  });

  it("counts the wait once the two minutes are up", () => {
    expect(callClock(ago(3), now)).toMatchObject({ overdue: true, label: "3 min waiting" });
    expect(callClock(ago(90), now)).toMatchObject({ overdue: true, label: "2 hrs waiting" });
    expect(callClock(ago(60 * 24 * 3), now)).toMatchObject({ overdue: true, label: "3 days waiting" });
  });

  it("knows whether the call came in time", () => {
    expect(calledInTime(ago(10), ago(9))).toBe(true);
    expect(calledInTime(ago(10), ago(5))).toBe(false);
    expect(calledInTime(ago(10), null)).toBeNull();
  });
});

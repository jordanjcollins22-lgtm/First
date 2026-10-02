import { describe, expect, it } from "vitest";

import { callClock } from "@/lib/mow-calls";

const now = new Date("2026-10-02T18:00:00Z");
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

describe("the 24-hour call promise", () => {
  it("counts down from payment", () => {
    expect(callClock(ago(2), now)).toMatchObject({ overdue: false, label: "22 hrs left to call" });
    expect(callClock(ago(23.5), now)).toMatchObject({ overdue: false, label: "1 hr left to call" });
  });

  it("says how late once the 24 hours are up", () => {
    expect(callClock(ago(24.2), now)).toMatchObject({ overdue: true, label: "1 hr past the 24" });
    expect(callClock(ago(30), now)).toMatchObject({ overdue: true, label: "6 hrs past the 24" });
  });
});

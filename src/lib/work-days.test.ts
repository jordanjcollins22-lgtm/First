import { describe, expect, it } from "vitest";

import { addWorkDays, nextWorkDay } from "@/lib/work-days";

describe("work days", () => {
  it("skips Sundays", () => {
    expect(addWorkDays("2026-11-27", 2)).toBe("2026-11-30"); // Fri + 2 -> Sat, (Sun), Mon
    expect(addWorkDays("2026-11-25", 0)).toBe("2026-11-25");
  });
  it("moves a Sunday start to Monday", () => {
    expect(addWorkDays("2026-11-29", 0)).toBe("2026-11-30");
  });
  it("finds the next work day", () => {
    expect(nextWorkDay("2026-11-28")).toBe("2026-11-30");
    expect(nextWorkDay("2026-11-25")).toBe("2026-11-26");
  });
});

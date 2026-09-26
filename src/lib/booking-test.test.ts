import { describe, expect, it } from "vitest";

import { assignedVariant, pickVariant, summariseTest, type VisitRow } from "./booking-test";

const visit = (variant: "tap" | "type", booked: boolean, over: Partial<VisitRow> = {}): VisitRow => ({
  variant,
  agent: "browser",
  locatedTapped: false,
  locatedResult: null,
  booked,
  ...over,
});

describe("assignedVariant", () => {
  it("deals once and keeps it", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(assignedVariant(storage, () => 0.1)).toBe("tap");
    expect(assignedVariant(storage, () => 0.9)).toBe("tap");
    expect(pickVariant(() => 0.9)).toBe("type");
  });

  it("still deals with no storage", () => {
    expect(assignedVariant(null, () => 0.9)).toBe("type");
  });
});

describe("summariseTest", () => {
  it("counts bookings over visits per side and ignores crawlers", () => {
    const rows = [
      ...Array.from({ length: 40 }, (_, i) => visit("tap", i < 12, { locatedTapped: i < 20, locatedResult: i < 15 ? "accepted" : i < 20 ? "declined" : null })),
      ...Array.from({ length: 40 }, (_, i) => visit("type", i < 4)),
      visit("tap", false, { agent: "crawler" }),
    ];
    const s = summariseTest(rows);
    expect(s.tap.visits).toBe(40);
    expect(s.tap.bookings).toBe(12);
    expect(s.tap.tapped).toBe(20);
    expect(s.tap.accepted).toBe(15);
    expect(s.tap.declined).toBe(5);
    expect(s.type.rate).toBe(0.1);
    expect(s.lift).toBeCloseTo(0.2);
    expect(s.confidence).toBeGreaterThan(0.95);
    expect(s.verdict).toMatch(/Tapping books more/);
  });

  it("refuses to call it early", () => {
    const s = summariseTest([visit("tap", true), visit("type", false)]);
    expect(s.verdict).toMatch(/Too early/);
  });
});

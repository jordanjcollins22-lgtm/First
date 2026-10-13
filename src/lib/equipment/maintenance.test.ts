import { describe, expect, it } from "vitest";

import {
  allDue,
  applyUsage,
  dueStatus,
  intervalsFor,
  readingWarning,
  shouldRaiseAlert,
  typeOf,
  type Asset,
  type ServiceInterval,
} from "@/lib/equipment/maintenance";

const mower: Asset = { id: "a1", name: "Big mower", kind: "mower", equipmentType: null, meter: "hours", mileage: null, engineHours: 420 };
const truck: Asset = { id: "a2", name: "The Titan", kind: "truck", equipmentType: null, meter: "miles", mileage: 152000, engineHours: null };
const interval = (over: Partial<ServiceInterval>): ServiceInterval => ({
  id: "i",
  assetId: null,
  equipmentType: "mower",
  task: "Oil and filter change",
  everyHours: 100,
  everyMiles: null,
  everyDays: 365,
  isDefault: true,
  active: true,
  ...over,
});
const soon = { days: 14, hours: 10, miles: 500 };

describe("typeOf", () => {
  it("uses the finer type when set, else the kind", () => {
    expect(typeOf({ kind: "other", equipmentType: "trimmer" })).toBe("trimmer");
    expect(typeOf({ kind: "truck", equipmentType: null })).toBe("truck");
    expect(typeOf({ kind: "boat", equipmentType: null })).toBe("other");
  });
});

describe("intervalsFor", () => {
  it("lets a machine's own interval replace its type's for the same task", () => {
    const list = intervalsFor(mower, [
      interval({ id: "type-oil" }),
      interval({ id: "type-blade", task: "Blade sharpening", everyHours: 25, everyDays: null }),
      interval({ id: "own-oil", assetId: "a1", equipmentType: null, task: "oil and filter change", everyHours: 50 }),
      interval({ id: "truck", equipmentType: "truck" }),
      interval({ id: "off", task: "Off", active: false }),
    ]);
    expect(list.map((i) => i.id).sort()).toEqual(["own-oil", "type-blade"]);
  });
});

describe("dueStatus", () => {
  it("is never_logged, not overdue, with no record", () => {
    expect(dueStatus(mower, interval({}), null, "2026-10-13", soon).state).toBe("never_logged");
  });
  it("is overdue by hours, whichever comes first", () => {
    const s = dueStatus(mower, interval({}), { assetId: "a1", task: "Oil and filter change", doneOn: "2026-09-01", atHours: 310, atMiles: null }, "2026-10-13", soon);
    expect(s.state).toBe("overdue");
    expect(s.dueAtHours).toBe(410);
    expect(s.reason).toMatch(/Due at 410 h \(now 420 h\)/);
  });
  it("is due soon inside the window, and ok outside it", () => {
    const rec = { assetId: "a1", task: "Oil and filter change", doneOn: "2026-09-01", atHours: 325, atMiles: null };
    expect(dueStatus(mower, interval({}), rec, "2026-10-13", soon).state).toBe("due_soon");
    expect(dueStatus(mower, interval({}), { ...rec, atHours: 400 }, "2026-10-13", soon).state).toBe("ok");
  });
  it("is overdue by the calendar", () => {
    const s = dueStatus(truck, interval({ equipmentType: "truck", task: "Registration", everyHours: null, everyDays: 365 }), { assetId: "a2", task: "Registration", doneOn: "2025-10-01", atHours: null, atMiles: null }, "2026-10-13", soon);
    expect(s.state).toBe("overdue");
    expect(s.dueOn).toBe("2026-10-01");
  });
  it("counts miles from the reading at the last service", () => {
    const s = dueStatus(truck, interval({ equipmentType: "truck", everyHours: null, everyMiles: 5000, everyDays: null }), { assetId: "a2", task: "Oil and filter change", doneOn: "2026-09-01", atHours: null, atMiles: 147300 }, "2026-10-13", soon);
    expect(s.state).toBe("due_soon");
  });
  it("keys an overdue stretch by the last service so one stretch is one alert", () => {
    const s = dueStatus(mower, interval({}), { assetId: "a1", task: "Oil and filter change", doneOn: "2026-09-01", atHours: 300, atMiles: null }, "2026-10-13", soon);
    expect(s.dedupeKey).toBe("equipment:a1:oil and filter change:2026-09-01");
  });
});

describe("allDue", () => {
  it("puts overdue first", () => {
    const list = allDue(
      [mower],
      [interval({ id: "oil" }), interval({ id: "blade", task: "Blade sharpening", everyHours: 25, everyDays: null })],
      [{ assetId: "a1", task: "Oil and filter change", doneOn: "2026-10-01", atHours: 415, atMiles: null }, { assetId: "a1", task: "Blade sharpening", doneOn: "2026-10-01", atHours: 380, atMiles: null }],
      "2026-10-13",
      soon
    );
    expect(list.map((s) => [s.task, s.state])).toEqual([
      ["Blade sharpening", "overdue"],
      ["Oil and filter change", "ok"],
    ]);
  });
});

describe("shouldRaiseAlert", () => {
  const overdue = { state: "overdue" as const, dueOn: "2026-10-01" };
  it("needs the alerts switched on", () => {
    expect(shouldRaiseAlert({ status: overdue, startedAt: null, lastActivityAt: "2026-10-12T00:00:00Z" })).toBe(false);
  });
  it("does not page about the backlog that existed on the day it was switched on", () => {
    expect(shouldRaiseAlert({ status: overdue, startedAt: "2026-10-10T12:00:00Z", lastActivityAt: "2026-09-01T00:00:00Z" })).toBe(false);
    expect(shouldRaiseAlert({ status: { state: "overdue", dueOn: null }, startedAt: "2026-10-10T12:00:00Z", lastActivityAt: null })).toBe(false);
  });
  it("raises what went overdue afterwards, by date or by new hours logged", () => {
    expect(shouldRaiseAlert({ status: { state: "overdue", dueOn: "2026-10-11" }, startedAt: "2026-10-10T12:00:00Z", lastActivityAt: null })).toBe(true);
    expect(shouldRaiseAlert({ status: { state: "overdue", dueOn: null }, startedAt: "2026-10-10T12:00:00Z", lastActivityAt: "2026-10-12T17:00:00Z" })).toBe(true);
    expect(shouldRaiseAlert({ status: { state: "due_soon", dueOn: "2026-10-20" }, startedAt: "2026-10-10T12:00:00Z", lastActivityAt: "2026-10-12T17:00:00Z" })).toBe(false);
  });
});

describe("applyUsage", () => {
  it("only moves a meter forward", () => {
    expect(applyUsage(truck, null, { reading: 152400, usedHours: null }).mileage).toBe(152400);
    expect(applyUsage(truck, null, { reading: 15240, usedHours: null }).mileage).toBe(152000);
    expect(applyUsage(mower, null, { reading: 425.4, usedHours: null }).engineHours).toBe(425.4);
  });
  it("adds hours run on a machine with no meter, and a correction replaces the first figure", () => {
    const blower: Asset = { id: "b", name: "Blower", kind: "other", equipmentType: "blower", meter: "none", mileage: null, engineHours: 10 };
    expect(applyUsage(blower, null, { reading: null, usedHours: 3 }).engineHours).toBe(13);
    expect(applyUsage({ ...blower, engineHours: 13 }, { reading: null, usedHours: 3 }, { reading: null, usedHours: 2 }).engineHours).toBe(12);
  });
  it("warns about a reading lower than the meter", () => {
    expect(readingWarning(truck, 15240)).toMatch(/already reads 152,000/);
    expect(readingWarning(truck, 152100)).toBeNull();
  });
});

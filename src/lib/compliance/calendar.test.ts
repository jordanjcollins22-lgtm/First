import { describe, expect, it } from "vitest";

import {
  creditsShort,
  daysUntil,
  marylandDefaults,
  nextAnnual,
  nextOfDates,
  obligationState,
  QUARTERLY_PAYROLL_DUE,
  reminderDue,
  reminderText,
  rollForward,
} from "./calendar";

describe("dates", () => {
  it("counts days to a due date", () => {
    expect(daysUntil("2026-10-20", "2026-10-13")).toBe(7);
    expect(daysUntil("2026-10-12", "2026-10-13")).toBe(-1);
  });
  it("finds the next annual date", () => {
    expect(nextAnnual(6, 30, "2026-10-13")).toBe("2027-06-30");
    expect(nextAnnual(12, 31, "2026-10-13")).toBe("2026-12-31");
    expect(nextAnnual(6, 30, "2026-06-30")).toBe("2026-06-30");
  });
  it("finds the next quarterly date", () => {
    expect(nextOfDates(QUARTERLY_PAYROLL_DUE, "2026-10-13")).toBe("2026-10-31");
    expect(nextOfDates(QUARTERLY_PAYROLL_DUE, "2026-11-01")).toBe("2027-01-31");
  });
  it("rolls forward by recurrence", () => {
    expect(rollForward("2026-06-30", "annual")).toBe("2027-06-30");
    expect(rollForward("2026-06-30", "biennial")).toBe("2028-06-30");
    expect(rollForward("2026-10-31", "quarterly")).toBe("2027-01-31");
    expect(rollForward("2028-02-29", "annual")).toBe("2029-02-28");
    expect(rollForward("2026-06-30", "none")).toBeNull();
  });
});

describe("reminders", () => {
  it("sends the tightest threshold crossed, once per threshold", () => {
    expect(reminderDue("2026-12-31", "2026-10-13")).toBeNull(); // 79 days
    expect(reminderDue("2026-12-01", "2026-10-13")).toBe(60); // 49 days
    expect(reminderDue("2026-11-02", "2026-10-13")).toBe(30); // 20 days
    expect(reminderDue("2026-10-20", "2026-10-13")).toBe(7);
    expect(reminderDue("2026-10-13", "2026-10-13")).toBe(7);
    expect(reminderDue("2026-10-12", "2026-10-13")).toBe("overdue");
  });
  it("says to confirm a default date", () => {
    expect(reminderText({ title: "MDA license", dueOn: "2026-10-20", dateConfirmed: false }, 7, "2026-10-13")).toMatch(/confirm/);
    expect(reminderText({ title: "MDA license", dueOn: "2026-10-20", dateConfirmed: true }, 7, "2026-10-13")).not.toMatch(/confirm/);
  });
});

describe("obligationState", () => {
  const base = { id: "1", kind: "other", title: "x", recurrence: "annual" as const, active: true, dateConfirmed: true };
  it("classifies", () => {
    expect(obligationState({ ...base, dueOn: "2026-10-01" }, "2026-10-13")).toBe("overdue");
    expect(obligationState({ ...base, dueOn: "2026-11-01" }, "2026-10-13")).toBe("due_soon");
    expect(obligationState({ ...base, dueOn: "2027-01-31" }, "2026-10-13")).toBe("upcoming");
    expect(obligationState({ ...base, dueOn: "2027-06-30" }, "2026-10-13")).toBe("ok");
    expect(obligationState({ ...base, dueOn: null }, "2026-10-13")).toBe("no_date");
    expect(obligationState({ ...base, dueOn: "2026-01-01", active: false }, "2026-10-13")).toBe("inactive");
  });
});

describe("marylandDefaults", () => {
  const seeds = marylandDefaults("2026-10-13");
  it("seeds the MDA license for June 30 and the fertilizer cert for Dec 31", () => {
    expect(seeds.find((s) => s.seedKey === "mda_business_license")?.dueOn).toBe("2027-06-30");
    expect(seeds.find((s) => s.seedKey === "fertilizer_applicator")?.dueOn).toBe("2026-12-31");
  });
  it("starts MHIC and H-2B inactive and insurance blank", () => {
    expect(seeds.find((s) => s.kind === "mhic_license")?.active).toBe(false);
    expect(seeds.find((s) => s.kind === "h2b")?.active).toBe(false);
    expect(seeds.filter((s) => s.kind.startsWith("insurance_")).every((s) => s.dueOn === null)).toBe(true);
  });
  it("has unique seed keys", () => {
    expect(new Set(seeds.map((s) => s.seedKey)).size).toBe(seeds.length);
  });
  it("tracks applicator credits", () => {
    expect(creditsShort({ creditsRequired: 8, creditsEarned: 3 })).toBe(5);
    expect(creditsShort({ creditsRequired: null, creditsEarned: null })).toBeNull();
  });
});

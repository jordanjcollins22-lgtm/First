import { describe, expect, it } from "vitest";

import { addBusinessDays, checklistFor, checklistProgress, handlesPesticidesByDefault, isItemOverdue } from "./onboarding";

describe("addBusinessDays", () => {
  it("skips weekends", () => {
    // 2026-10-15 is a Thursday.
    expect(addBusinessDays("2026-10-15", 3)).toBe("2026-10-20");
    expect(addBusinessDays("2026-10-12", 3)).toBe("2026-10-15");
  });
});

describe("checklistFor", () => {
  it("gives an employee the federal and Maryland items with their deadlines", () => {
    const items = checklistFor({ position: "project-technician", startDate: "2026-10-15", handlesPesticides: true });
    const by = Object.fromEntries(items.map((i) => [i.key, i.dueOn]));
    expect(by.i9).toBe("2026-10-20");
    expect(by.w4).toBe("2026-10-15");
    expect(by.mw507).toBe("2026-10-15");
    expect(by.md_new_hire).toBe("2026-11-04");
    expect(by.pesticide_training).toBe("2026-11-14");
    expect(by.handbook).toBeDefined();
    expect(by.safety).toBeDefined();
  });
  it("leaves pesticide training off when they won't handle chemicals", () => {
    const items = checklistFor({ position: "account-manager", startDate: "2026-10-15", handlesPesticides: false });
    expect(items.some((i) => i.key === "pesticide_training")).toBe(false);
  });
  it("gives an affiliate a W-9, not a W-4", () => {
    const keys = checklistFor({ position: "affiliate", startDate: "2026-10-15", handlesPesticides: false }).map((i) => i.key);
    expect(keys).toContain("w9");
    expect(keys).not.toContain("w4");
  });
  it("defaults pesticide handling on for field positions", () => {
    expect(handlesPesticidesByDefault("project-lead")).toBe(true);
    expect(handlesPesticidesByDefault("evaluator")).toBe(false);
  });
});

describe("progress", () => {
  it("counts overdue, done and waived", () => {
    const items = [
      { dueOn: "2026-10-01", doneAt: null, waived: false },
      { dueOn: "2026-10-01", doneAt: "2026-10-02", waived: false },
      { dueOn: "2026-10-01", doneAt: null, waived: true },
      { dueOn: "2026-12-01", doneAt: null, waived: false },
    ];
    expect(isItemOverdue(items[0], "2026-10-13")).toBe(true);
    expect(checklistProgress(items, "2026-10-13")).toEqual({ done: 2, total: 4, overdue: 1, complete: false });
  });
});

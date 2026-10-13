import { describe, expect, it } from "vitest";

import { kitsForServices, loadoutOverdue, minutesOfTime, serviceIdsFrom } from "@/lib/equipment/kits";

describe("serviceIdsFrom", () => {
  it("reads drawn zones in every shape they come in, plus requested services", () => {
    const ids = serviceIdsFrom(
      [{ service: { typeId: "landscape-bed" } }, { serviceTypeId: "trimming" }, { services: [{ service_type_id: "grading" }] }, null],
      [{ service_type_id: "trimming" }, { service_type_id: "soft-washing" }]
    );
    expect(ids.sort()).toEqual(["grading", "landscape-bed", "soft-washing", "trimming"]);
    expect(serviceIdsFrom(null, [])).toEqual([]);
  });
});

describe("kitsForServices", () => {
  const serviceTools = [
    { service_type_id: "bed", tool_id: "shovel" },
    { service_type_id: "bed", tool_id: "rake" },
    { service_type_id: "bed", tool_id: "edger" },
    { service_type_id: "trim", tool_id: "pruners" },
    { service_type_id: "trim", tool_id: "ladder" },
  ];
  const tools = [
    { id: "shovel", kits: [1, 3] },
    { id: "rake", kits: [1] },
    { id: "edger", kits: [3] },
    { id: "pruners", kits: [2] },
    { id: "ladder", kits: [] },
  ];

  it("covers every tool with the fewest kits and loads kit-less tools loose", () => {
    expect(kitsForServices(["bed"], serviceTools, tools)).toEqual({ kits: [1, 3], looseToolIds: [] });
    expect(kitsForServices(["trim"], serviceTools, tools)).toEqual({ kits: [2], looseToolIds: ["ladder"] });
  });
  it("doesn't load a second kit for a tool the first already carries", () => {
    expect(kitsForServices(["bed"], serviceTools.filter((r) => r.tool_id !== "edger"), tools)).toEqual({ kits: [1], looseToolIds: [] });
  });
  it("is empty for services with no tools", () => {
    expect(kitsForServices(["mow"], serviceTools, tools)).toEqual({ kits: [], looseToolIds: [] });
  });
});

describe("loadoutOverdue", () => {
  const base = { nowMinutes: 8 * 60, shopMinutes: 7 * 60, graceMinutes: 60, itemCount: 3, complete: false, leftShop: false, throughShop: true };
  it("is overdue after the grace with an unticked list and no departure", () => {
    expect(loadoutOverdue(base)).toBe(true);
    expect(loadoutOverdue({ ...base, nowMinutes: 7 * 60 + 59 })).toBe(false);
  });
  it("is never overdue for somebody meeting on site, with nothing to load, ticked, or gone", () => {
    expect(loadoutOverdue({ ...base, throughShop: false })).toBe(false);
    expect(loadoutOverdue({ ...base, itemCount: 0 })).toBe(false);
    expect(loadoutOverdue({ ...base, complete: true })).toBe(false);
    expect(loadoutOverdue({ ...base, leftShop: true })).toBe(false);
  });
  it("reads shop times", () => {
    expect(minutesOfTime("06:30:00")).toBe(390);
    expect(minutesOfTime(null)).toBe(420);
  });
});

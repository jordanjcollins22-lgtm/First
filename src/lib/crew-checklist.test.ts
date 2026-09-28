import { describe, expect, it } from "vitest";

import { buildCrewChecklist } from "./crew-checklist";

describe("buildCrewChecklist", () => {
  const checklist = buildCrewChecklist({
    zones: [
      { id: "a", name: "Front bed", serviceTypeId: "landscape-bed", serviceName: "Landscape Bed" },
      { id: "b", name: "Side bed", serviceTypeId: "landscape-bed", serviceName: "Landscape Bed" },
      { id: "c", name: "Back lawn", serviceTypeId: "lawn-care", serviceName: "Lawn Care" },
    ],
    serviceTools: [
      { service_type_id: "landscape-bed", tool_id: "t1" },
      { service_type_id: "landscape-bed", tool_id: "t2" },
      { service_type_id: "lawn-care", tool_id: "t1" },
      { service_type_id: "soft-washing", tool_id: "t3" },
    ],
    tools: [
      { id: "t1", name: "Wheelbarrow" },
      { id: "t2", name: "Edger" },
      { id: "t3", name: "Pressure washer" },
    ],
    materials: [
      { material: "Brown mulch", unit: "cubic yards", quantity: 2 },
      { material: "Brown mulch", unit: "cubic yards", quantity: 1.5 },
      { material: "Weed fabric", unit: "sq ft", quantity: 0, manual: true },
    ],
    finishedZoneIds: new Set(["a"]),
  });

  it("lists each tool once, only for services on the job", () => {
    expect(checklist.tools).toEqual(["Edger", "Wheelbarrow"]);
  });

  it("adds up the same material across areas", () => {
    expect(checklist.materials).toEqual([
      { name: "Brown mulch", amount: "3.5 cubic yards" },
      { name: "Weed fabric", amount: "As needed" },
    ]);
  });

  it("ticks an area off once it has its after photo", () => {
    expect(checklist.areas.map((a) => [a.name, a.done])).toEqual([
      ["Front bed", true],
      ["Side bed", false],
      ["Back lawn", false],
    ]);
  });

  it("sends the crew for the kit, not the tools in it, with its photo", () => {
    const kitted = buildCrewChecklist({
      zones: [{ id: "a", name: "Front", serviceTypeId: "landscape-cleanup", serviceName: "Cleanup" }],
      serviceTools: [
        { service_type_id: "landscape-cleanup", tool_id: "rake" },
        { service_type_id: "landscape-cleanup", tool_id: "saw" },
        { service_type_id: "landscape-cleanup", tool_id: "tarp" },
      ],
      tools: [
        { id: "rake", name: "Rake", kits: [1, 2] },
        { id: "broom", name: "Push broom", kits: [1, 2] },
        { id: "saw", name: "Reciprocating saw", kits: [4] },
        { id: "tarp", name: "Tarp", kits: [] },
      ],
      materials: [],
      finishedZoneIds: new Set(),
      kitPhotos: { 1: "https://example.test/kit-1.jpg" },
    });
    expect(kitted.kits).toEqual([
      { kit: 1, contents: ["Push broom", "Rake"], photoUrl: "https://example.test/kit-1.jpg" },
      { kit: 4, contents: ["Reciprocating saw"], photoUrl: null },
    ]);
    expect(kitted.tools).toEqual(["Tarp"]);
  });
});

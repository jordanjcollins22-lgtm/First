import { describe, expect, it } from "vitest";

import { buildWorkOrder, polygonPoints, zonesBounds } from "@/lib/work-order";
import type { WorkZone } from "@/components/canvas/types";

const catalog = {
  servicePricing: [
    { service_type_id: "mulch", name: "Mulch bed", cost: 12.5, cogs: 4 },
    { service_type_id: "hedge", name: "Hedge trim", cost: 40, cogs: 10 },
  ],
  tools: [
    { id: "t1", name: "Wheelbarrow" },
    { id: "t2", name: "Hedge trimmer" },
    { id: "t3", name: "Leaf blower" },
  ],
  serviceTools: [{ service_type_id: "hedge", tool_id: "t2" }],
} as unknown as Parameters<typeof buildWorkOrder>[1];

function zone(overrides: Partial<WorkZone> = {}): WorkZone {
  return {
    id: "z1",
    name: "Front bed",
    color: "#2f6d3c",
    points: [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
    ],
    location: "Front left of the drive",
    lengthFt: 20,
    widthFt: 4,
    areaSqFt: 80,
    perimeterFt: 48,
    service: {
      typeId: "mulch",
      values: { Depth: "3 inches", Edging: "Yes" },
      notes: "Watch the sprinkler heads",
      photos: [],
      tools: ["t1", "t3"],
    },
    ...overrides,
  } as WorkZone;
}

describe("buildWorkOrder", () => {
  it("names the service in words, not an id", () => {
    expect(buildWorkOrder([zone()], catalog).zones[0].service).toBe("Mulch bed");
  });

  it("carries the checklist answers as the instructions", () => {
    const tasks = buildWorkOrder([zone()], catalog).zones[0].tasks;
    expect(tasks).toEqual([
      { label: "Depth", value: "3 inches" },
      { label: "Edging", value: "Yes" },
    ]);
  });

  it("uses the words the evaluator saw, not the raw field key", () => {
    // A crew reading "edge_type: hardwood" has a worse instruction than none.
    const z = zone({
      service: { typeId: "mulch", values: { edge_type: "Spade cut" }, notes: "", photos: [], tools: [] },
    } as Partial<WorkZone>);
    const order = buildWorkOrder([z], catalog, {}, (typeId, key) =>
      typeId === "mulch" && key === "edge_type" ? "Edge type" : key
    );
    expect(order.zones[0].tasks).toEqual([{ label: "Edge type", value: "Spade cut" }]);
  });

  it("drops blank checklist answers rather than showing empty rows", () => {
    const z = zone({
      service: { typeId: "mulch", values: { Depth: "3 inches", Edging: "" }, notes: "", photos: [], tools: [] },
    } as Partial<WorkZone>);
    expect(buildWorkOrder([z], catalog).zones[0].tasks).toEqual([{ label: "Depth", value: "3 inches" }]);
  });

  it("resolves the zone's own tools to names", () => {
    expect(buildWorkOrder([zone()], catalog).zones[0].toolNames).toEqual(["Wheelbarrow", "Leaf blower"]);
  });

  it("falls back to the service's default kit when the zone lists none", () => {
    // An older design still has to tell somebody what to load.
    const z = zone({
      service: { typeId: "hedge", values: {}, notes: "", photos: [], tools: [] },
    } as Partial<WorkZone>);
    expect(buildWorkOrder([z], catalog).zones[0].toolNames).toEqual(["Hedge trimmer"]);
  });

  it("builds one deduped, sorted loading list for the whole job", () => {
    const a = zone({ id: "z1" });
    const b = zone({
      id: "z2",
      service: { typeId: "hedge", values: {}, notes: "", photos: [], tools: ["t2", "t3"] },
    } as Partial<WorkZone>);
    expect(buildWorkOrder([a, b], catalog).toolNames).toEqual([
      "Hedge trimmer",
      "Leaf blower",
      "Wheelbarrow",
    ]);
  });

  it("skips zones with no service, which are drafting artefacts", () => {
    // Sending somebody to a zone with no instructions wastes a trip.
    expect(buildWorkOrder([zone({ service: null })], catalog).zones).toEqual([]);
  });

  it("describes size from length and width when it has them", () => {
    expect(buildWorkOrder([zone()], catalog).zones[0].sizeLabel).toBe("20 × 4 ft");
  });

  it("falls back to area when there is no length and width", () => {
    const z = zone({ lengthFt: null, widthFt: null, areaSqFt: 1234.7 });
    expect(buildWorkOrder([z], catalog).zones[0].sizeLabel).toBe("1,235 sq ft");
  });

  it("says nothing about size rather than guessing", () => {
    const z = zone({ lengthFt: null, widthFt: null, areaSqFt: null });
    expect(buildWorkOrder([z], catalog).zones[0].sizeLabel).toBeNull();
  });

  it("carries no money anywhere, whatever the catalog holds", () => {
    // The guarantee: a work order has nowhere to put a price, so no future
    // change to a component can leak one.
    const order = buildWorkOrder([zone()], catalog, {
      z1: [{ name: "Hardwood mulch", quantityLabel: "3 yd" }],
    });
    const serialised = JSON.stringify(order);
    expect(serialised).not.toContain("cost");
    expect(serialised).not.toContain("cogs");
    expect(serialised).not.toContain("price");
    expect(serialised).not.toContain("12.5");
  });

  it("passes materials through with quantities and no costs", () => {
    const order = buildWorkOrder([zone()], catalog, {
      z1: [{ name: "Hardwood mulch", quantityLabel: "3 yd" }],
    });
    expect(order.zones[0].materials).toEqual([{ name: "Hardwood mulch", quantityLabel: "3 yd" }]);
  });
});

describe("zonesBounds", () => {
  it("frames the drawn area with padding", () => {
    const bounds = zonesBounds([{ points: [{ x: 300, y: 300 }, { x: 400, y: 500 }] }], 1280, 800, 40);
    expect(bounds).toEqual({ x: 260, y: 260, width: 180, height: 280 });
  });

  it("never frames outside the canvas", () => {
    const bounds = zonesBounds([{ points: [{ x: 10, y: 10 }] }], 1280, 800, 40);
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
  });

  it("falls back to the whole canvas with nothing drawn", () => {
    expect(zonesBounds([], 1280, 800)).toEqual({ x: 0, y: 0, width: 1280, height: 800 });
  });
});

describe("polygonPoints", () => {
  it("writes an SVG points attribute", () => {
    expect(polygonPoints([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toBe("1,2 3,4");
  });
});

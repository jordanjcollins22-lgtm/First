import { describe, expect, it } from "vitest";

import { numberWorkItems, parseProject } from "@/lib/evaluation-line-items";
import { DEFAULT_LIBRARY, parseLibrary } from "@/lib/resource-library";
import { calculateItem, calculateProject, toRateQuantity } from "@/lib/stage3-calculations";
import { scopeLine } from "@/lib/stage6-output";

const lib = parseLibrary(DEFAULT_LIBRARY);

// Jordan's two-zone example, with plant sizes measured.
const measured = (size: string) => ({ size_class: { value: size, source: "measured" as const } });
const project = numberWorkItems(
  parseProject({
    project_id: 1001,
    zones: [
      {
        zone_id: 1,
        name: "front_mulch_bed",
        work_items: [
          { operation: "remove", material: "plant", subtype: "japanese_barberry", quantity: 1, unit: "each", measurements: measured("small") },
          { operation: "remove", material: "plant", subtype: "japanese_barberry", quantity: 1, unit: "each", measurements: measured("large") },
          { operation: "remove", material: "plant", subtype: "arborvitae", quantity: 1, unit: "each", measurements: measured("medium") },
          { operation: "install", material: "mulch", subtype: "brown_hardwood", quantity: 200, unit: "sqft" },
        ],
      },
      {
        zone_id: 2,
        name: "backyard",
        work_items: [
          { operation: "remove", material: "plant", subtype: "boxwood", quantity: 3, unit: "each", measurements: measured("small") },
          { operation: "install", material: "stone", subtype: "river_rock", quantity: 150, unit: "sqft" },
        ],
      },
    ],
  }),
);

describe("toRateQuantity", () => {
  it("matches the doc: 200 sq ft at 2 inches is about 1.235 cubic yards", () => {
    expect(toRateQuantity(200, "sqft", "cuyd", { depth_in: 2 }, {}).quantity).toBeCloseTo(1.2346, 4);
  });

  it("turns square feet into tons with depth and weight", () => {
    expect(toRateQuantity(150, "sqft", "ton", { depth_in: 2 }, { physical: { density_ton_per_cuyd: 1.35 } }).quantity).toBeCloseTo(1.25, 3);
  });

  it("names everything that's missing", () => {
    expect(toRateQuantity(200, "sqft", "cuyd", {}, {})).toEqual({ quantity: null, missing: ["standards.depth_in"] });
    expect(toRateQuantity(150, "sqft", "ton", {}, {}).missing).toEqual(["standards.depth_in", "physical.density_ton_per_cuyd"]);
    expect(toRateQuantity(1, "each", "ton", {}, {}).missing).toEqual(["conversion each to ton"]);
  });
});

describe("calculateProject on the example", () => {
  const result = calculateProject(lib, project);

  it("records the library version and production models it used", () => {
    expect(result.library_version).toBe(1);
    expect(result.items.map((i) => i.model_id)).toEqual(["shrub_remove", "shrub_remove", "shrub_remove", "mulch_install", "shrub_remove", "stone_install"]);
  });

  it("works out the plants by size and the mulch at 2 inches", () => {
    expect(result.items.map((i) => i.minutes)).toEqual([10, 50, 20, expect.closeTo((200 * 2) / 324 * 59.88, 6), 30, null]);
    expect(result.zones[0].minutes).toBeCloseTo(80 + (200 * 2) / 324 * 59.88, 6);
  });

  it("stops on river rock and says what it needs", () => {
    expect(result.zones[1].minutes).toBeNull();
    expect(result.minutes).toBeNull();
    expect(result.missing).toEqual([
      { item_id: 6, zone_id: 2, what: "standards.depth_in" },
      { item_id: 6, zone_id: 2, what: "physical.density_ton_per_cuyd" },
    ]);
  });

  it("lists each shared tool once", () => {
    const keys = result.resources.map((r) => r.key);
    expect(keys.filter((k) => k === "wheelbarrow")).toHaveLength(1);
    expect(keys).toEqual(expect.arrayContaining(["round_point_shovel", "dump_trailer", "mulch_fork", "bow_rake"]));
  });

  it("flags a size that was only estimated", () => {
    const item = { ...project.zones[1].work_items[0], measurements: { size_class: { value: "small", source: "estimated" as const } } };
    expect(calculateItem(lib, 2, item).provisional).toBe(true);
  });

  it("asks for a size it wasn't given", () => {
    const item = { ...project.zones[1].work_items[0], measurements: undefined };
    expect(calculateItem(lib, 2, item).missing).toEqual(["measurement size_class", "production rate"]);
  });
});

describe("scopeLine", () => {
  it("writes only the work, without adding anything", () => {
    expect(scopeLine(lib, project.zones[1].work_items[0])).toBe("Remove 3 existing boxwood.");
    expect(scopeLine(lib, project.zones[0].work_items[0])).toBe("Remove 1 existing Japanese barberry.");
    expect(scopeLine(lib, project.zones[0].work_items[3])).toBe(
      "Install brown hardwood mulch across approximately 200 square feet at our standard depth.",
    );
  });
});

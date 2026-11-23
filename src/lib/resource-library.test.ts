import { encode } from "@msgpack/msgpack";
import { describe, expect, it } from "vitest";

import { numberWorkItems, parseProject } from "@/lib/evaluation-line-items";
import {
  DEFAULT_LIBRARY,
  findOperation,
  itemLabor,
  packLibrary,
  parseLibrary,
  pickRate,
  projectLabor,
  scopeLine,
  toRateQuantity,
  unpackLibrary,
} from "@/lib/resource-library";

const lib = parseLibrary(DEFAULT_LIBRARY);

// Jordan's two-zone example, with sizes measured on the plants.
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

describe("the library file", () => {
  it("packs and reads back the starting library", () => {
    expect(unpackLibrary(packLibrary(DEFAULT_LIBRARY))).toEqual({ stage: 2, schema_version: 1, ...lib });
  });

  it("refuses a Stage 1 file, an unknown resource or a repeated operation", () => {
    expect(() => unpackLibrary(encode({ stage: 1, schema_version: 1 }))).toThrow();
    const m = DEFAULT_LIBRARY.materials[1];
    expect(() =>
      parseLibrary({ ...DEFAULT_LIBRARY, materials: [{ ...m, operations: [{ ...m.operations![0], needs: [{ resource: "laser" }] }] }] }),
    ).toThrow(/unknown resource/);
    expect(() => parseLibrary({ ...DEFAULT_LIBRARY, materials: [{ ...m, operations: [m.operations![0], m.operations![0]] }] })).toThrow(
      /defined twice/,
    );
  });
});

describe("findOperation", () => {
  it("uses the material's operation for a subtype without its own", () => {
    const found = findOperation(lib, { operation: "remove", material: "plant", subtype: "boxwood" });
    expect(found?.op.subtype).toBeNull();
    expect(found?.subtype?.name).toBe("Boxwood");
    expect(found?.properties).toEqual({ chemical_biological: { root_system: "shallow_fibrous" } });
  });

  it("prefers a subtype's own operation", () => {
    const own = parseLibrary({
      ...DEFAULT_LIBRARY,
      materials: DEFAULT_LIBRARY.materials.map((m) =>
        m.key === "plant"
          ? { ...m, operations: [...m.operations!, { operation: "remove", subtype: "arborvitae", unit: "each", rate_unit: "each", rates: [{ minutes_per_unit: 99 }] }] }
          : m,
      ),
    });
    expect(findOperation(own, { operation: "remove", material: "plant", subtype: "arborvitae" })?.op.rates[0].minutes_per_unit).toBe(99);
    expect(findOperation(own, { operation: "remove", material: "plant", subtype: "boxwood" })?.op.subtype).toBeNull();
  });

  it("finds nothing for work the library doesn't cover", () => {
    expect(findOperation(lib, { operation: "maintain", material: "plant", subtype: null })).toBeNull();
    expect(findOperation(lib, { operation: "install", material: "concrete", subtype: null })).toBeNull();
  });
});

describe("pickRate", () => {
  const op = findOperation(lib, { operation: "remove", material: "plant", subtype: "japanese_barberry" })!.op;

  it("keeps two barberries of different sizes apart", () => {
    expect(pickRate(op, { measurements: measured("small") }).rate?.minutes_per_unit).toBe(10);
    expect(pickRate(op, { measurements: measured("large") }).rate?.minutes_per_unit).toBe(50);
  });

  it("asks for the size when it wasn't measured, rather than guessing", () => {
    expect(pickRate(op, {})).toEqual({ rate: null, needs: ["size_class"] });
  });
});

describe("toRateQuantity", () => {
  it("turns square feet into cubic yards at the standard depth", () => {
    expect(toRateQuantity(200, "sqft", "cuyd", { depth_in: 3 }, {}).quantity).toBeCloseTo(1.852, 3);
  });

  it("turns square feet into tons with depth and weight", () => {
    expect(toRateQuantity(150, "sqft", "ton", { depth_in: 2 }, { physical: { density_ton_per_cuyd: 1.35 } }).quantity).toBeCloseTo(1.25, 3);
  });

  it("names what's missing", () => {
    expect(toRateQuantity(200, "sqft", "cuyd", {}, {})).toEqual({ quantity: null, missing: ["standards.depth_in"] });
    expect(toRateQuantity(150, "sqft", "ton", { depth_in: 2 }, {}).missing).toEqual(["physical.density_ton_per_cuyd"]);
  });
});

describe("projectLabor on the example", () => {
  it("works out the plant removals and lists what the rest still needs", () => {
    const result = projectLabor(lib, project);
    // 10 + 50 + 20 minutes in zone 1's plants, 3 × 10 in zone 2.
    expect(result.items.filter((i) => i.minutes != null).map((i) => i.minutes)).toEqual([10, 50, 20, 30]);
    expect(result.minutes).toBeNull();
    expect(result.missing).toEqual([
      { item_id: 4, zone_id: 1, what: "standards.depth_in" },
      { item_id: 6, zone_id: 2, what: "standards.depth_in" },
      { item_id: 6, zone_id: 2, what: "physical.density_ton_per_cuyd" },
    ]);
  });

  it("totals by zone and project once the standards are set", () => {
    const filled = parseLibrary({
      ...DEFAULT_LIBRARY,
      materials: DEFAULT_LIBRARY.materials.map((m) => ({
        ...m,
        subtypes: m.key === "stone" ? [{ key: "river_rock", name: "River rock", properties: { physical: { density_ton_per_cuyd: 1.35 } } }] : m.subtypes,
        operations: m.operations!.map((o) => (m.key === "plant" ? o : { ...o, standards: { depth_in: m.key === "mulch" ? 3 : 2 } })),
      })),
    });
    const result = projectLabor(filled, project);
    expect(result.missing).toEqual([]);
    expect(result.zones[0].minutes).toBeCloseTo(80 + (200 * 3) / 12 / 27 * 59.88, 6);
    expect(result.zones[1].minutes).toBeCloseTo(30 + 1.25 * 120.48, 6);
    expect(result.minutes).toBeCloseTo(result.zones[0].minutes! + result.zones[1].minutes!, 6);
    expect(result.items.every((i) => i.provisional)).toBe(true);
  });

  it("lists each shared tool once, however many operations use it", () => {
    const keys = projectLabor(lib, project).resources.map((r) => r.key);
    expect(keys.filter((k) => k === "wheelbarrow")).toHaveLength(1);
    expect(keys).toEqual(expect.arrayContaining(["round_point_shovel", "dump_trailer", "pitchfork", "bow_rake"]));
  });

  it("flags a size that was only estimated", () => {
    const item = { ...project.zones[1].work_items[0], measurements: { size_class: { value: "small", source: "estimated" as const } } };
    expect(itemLabor(lib, 2, item).provisional).toBe(true);
  });
});

describe("scopeLine", () => {
  it("writes the proposal line from the work item alone", () => {
    expect(scopeLine(lib, project.zones[1].work_items[0])).toBe("Remove 3 existing boxwood, including root removal and debris disposal.");
    expect(scopeLine(lib, project.zones[0].work_items[3])).toBe(
      "Prepare the bed and install brown hardwood mulch across approximately 200 square feet at our standard depth.",
    );
  });
});

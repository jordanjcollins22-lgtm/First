import { encode } from "@msgpack/msgpack";
import { describe, expect, it } from "vitest";

import { libraryGaps, gapsCsv } from "@/lib/library-gaps";
import { MD_PLANTS } from "@/lib/resource-catalog-md";
import {
  DEFAULT_LIBRARY,
  findOperation,
  packLibrary,
  parseLibrary,
  pickRate,
  requiredInputs,
  unpackLibrary,
} from "@/lib/resource-library";

const lib = parseLibrary(DEFAULT_LIBRARY);

describe("the starting library", () => {
  it("is valid: no repeated ids, keys or production models", () => {
    expect(lib.version).toBe(1);
    expect(lib.materials.map((m) => m.key)).toEqual(["plant", "mulch", "stone", "soil", "turf", "hardscape", "edging", "drainage", "debris"]);
  });

  it("keeps the example's plants on their first numbers", () => {
    const plant = lib.materials[0];
    expect(plant.subtypes.slice(0, 3).map((s) => [s.id, s.key])).toEqual([
      [1001, "japanese_barberry"],
      [1002, "arborvitae"],
      [1003, "boxwood"],
    ]);
    expect(lib.materials[1].subtypes[0]).toMatchObject({ id: 2001, key: "brown_hardwood" });
    expect(plant.subtypes).toHaveLength(MD_PLANTS.length);
  });

  it("packs and reads back as resources.msgpack", () => {
    expect(unpackLibrary(packLibrary(DEFAULT_LIBRARY))).toEqual({ stage: 2, schema_version: 1, ...lib });
  });

  it("refuses a Stage 1 file, an unknown resource or a repeated id", () => {
    expect(() => unpackLibrary(encode({ stage: 1, schema_version: 1 }))).toThrow();
    const mulch = DEFAULT_LIBRARY.materials[1];
    const op = mulch.operations![0];
    expect(() => parseLibrary({ ...DEFAULT_LIBRARY, materials: [{ ...mulch, operations: [{ ...op, needs: [{ resource_id: 999 }] }] }] })).toThrow(
      /unknown resource/,
    );
    expect(() =>
      parseLibrary({ ...DEFAULT_LIBRARY, materials: [{ ...mulch, subtypes: [mulch.subtypes![0], { ...mulch.subtypes![1], id: 2001 }] }] }),
    ).toThrow(/defined twice/);
  });

  it("stores mulch at the company's 2 inch standard depth", () => {
    expect(findOperation(lib, { operation: "install", material: "mulch", subtype: "brown_hardwood" })?.op.standards).toEqual({ depth_in: 2 });
  });
});

describe("findOperation", () => {
  it("uses the shrub operation for a shrub without its own", () => {
    const found = findOperation(lib, { operation: "remove", material: "plant", subtype: "boxwood" });
    expect(found?.op.model_id).toBe("shrub_remove");
    expect(found?.subtype?.name).toBe("Boxwood");
    expect(found?.properties).toMatchObject({ kind: "evergreen_shrub", botanical_name: "Buxus spp." });
  });

  it("doesn't use shrub rates for a tree or a perennial", () => {
    expect(findOperation(lib, { operation: "remove", material: "plant", subtype: "red_maple" })).toBeNull();
    expect(findOperation(lib, { operation: "install", material: "plant", subtype: "hosta" })).toBeNull();
  });

  it("prefers a subtype's own operation", () => {
    const own = parseLibrary({
      ...DEFAULT_LIBRARY,
      materials: DEFAULT_LIBRARY.materials.map((m) =>
        m.key === "plant"
          ? {
              ...m,
              operations: [
                ...m.operations!,
                { operation: "remove", model_id: "arborvitae_remove", subtype: "arborvitae", unit: "each", rate_unit: "each", rates: [{ minutes_per_unit: 99 }] },
              ],
            }
          : m,
      ),
    });
    expect(findOperation(own, { operation: "remove", material: "plant", subtype: "arborvitae" })?.op.model_id).toBe("arborvitae_remove");
    expect(findOperation(own, { operation: "remove", material: "plant", subtype: "boxwood" })?.op.model_id).toBe("shrub_remove");
  });

  it("finds nothing for work the library doesn't cover yet", () => {
    expect(findOperation(lib, { operation: "install", material: "concrete", subtype: null })).toBeNull();
    expect(findOperation(lib, { operation: "remove", material: "stone", subtype: "river_rock" })).toBeNull();
  });
});

describe("pickRate and required inputs", () => {
  const op = findOperation(lib, { operation: "remove", material: "plant", subtype: "japanese_barberry" })!.op;
  const size = (v: string) => ({ size_class: { value: v, source: "measured" as const } });

  it("keeps two barberries of different sizes apart", () => {
    expect(pickRate(op, { measurements: size("small") }).rate?.minutes_per_unit).toBe(10);
    expect(pickRate(op, { measurements: size("large") }).rate?.minutes_per_unit).toBe(50);
  });

  it("asks for the size when it wasn't measured, rather than guessing", () => {
    expect(pickRate(op, {})).toEqual({ rate: null, needs: ["size_class"] });
  });

  it("tells the form what to collect and with which tool", () => {
    const inputs = requiredInputs(lib, { operation: "remove", material: "plant", subtype: "japanese_barberry" });
    expect(inputs.map((i) => i.key)).toEqual(["size_class", "height_ft"]);
    expect(inputs[1].tool_id).toBe(511);
  });
});

describe("the task list", () => {
  const { subtypes, resources } = libraryGaps(lib);

  it("lists every subtype, since none is fully filled in yet", () => {
    expect(subtypes).toHaveLength(lib.materials.reduce((n, m) => n + m.subtypes.length, 0));
    expect(resources).toHaveLength(lib.resources.length);
  });

  it("says what a barberry still needs", () => {
    const barberry = subtypes.find((r) => r.subtype === "japanese_barberry")!;
    expect(barberry).toMatchObject({ subtype_id: 1001, kind: "shrub", origin: "invasive" });
    expect(barberry.missing).toContain("root system");
    expect(barberry.missing).toContain("remove: rates not verified");
    expect(barberry.missing).not.toContain("remove: no production model");
  });

  it("says a tree has no production models yet", () => {
    const maple = subtypes.find((r) => r.subtype === "red_maple")!;
    expect(maple.missing).toEqual(expect.arrayContaining(["install: no production model", "remove: no production model", "maintain: no production model"]));
  });

  it("doesn't ask for mulch depth, which is set", () => {
    const mulch = subtypes.find((r) => r.subtype === "brown_hardwood")!;
    expect(mulch.missing).not.toContain("install: standard depth");
    expect(mulch.missing).toContain("price per cubic yard");
  });

  it("writes a CSV with a header and one row each", () => {
    const csv = gapsCsv(lib).trim().split("\n");
    expect(csv[0]).toBe("id,material,key,name,kind,origin,missing_count,missing");
    expect(csv).toHaveLength(1 + subtypes.length + resources.length);
  });
});

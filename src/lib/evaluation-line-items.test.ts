import { encode } from "@msgpack/msgpack";
import { describe, expect, it } from "vitest";

import {
  countWorkItems,
  fromByteaHex,
  numberWorkItems,
  packStage1,
  parseProject,
  sha256Hex,
  toByteaHex,
  toKey,
  unpackStage1,
  workItemSchema,
} from "@/lib/evaluation-line-items";

// Jordan's example, 2026-11-23.
const example = {
  project_id: 1001,
  zones: [
    {
      zone_id: 1,
      name: "front_mulch_bed",
      location: null,
      site_conditions: {},
      evidence: [],
      work_items: [
        { operation: "remove", material: "plant", subtype: "japanese_barberry", quantity: 2, unit: "each" },
        { operation: "remove", material: "plant", subtype: "arborvitae", quantity: 1, unit: "each" },
        { operation: "install", material: "mulch", subtype: "brown_hardwood", quantity: 200, unit: "sqft" },
      ],
    },
    {
      zone_id: 2,
      name: "backyard",
      location: null,
      site_conditions: {},
      evidence: [],
      work_items: [
        { operation: "remove", material: "plant", subtype: "boxwood", quantity: 3, unit: "each" },
        { operation: "install", material: "stone", subtype: "river_rock", quantity: 150, unit: "sqft" },
      ],
    },
  ],
};

describe("parseProject", () => {
  it("takes the example as it is", () => {
    expect(parseProject(example)).toEqual(example);
    expect(countWorkItems(parseProject(example))).toBe(5);
  });

  it("tidies words the way the file stores them", () => {
    expect(
      workItemSchema.parse({ operation: "Install", material: "Mulch", subtype: "Brown hardwood", quantity: "200", unit: "Square feet" }),
    ).toEqual(example.zones[0].work_items[2]);
    expect(toKey("  Front Bed (left) ")).toBe("front_bed_left");
  });

  it("fills in empty readings, evidence and a missing subtype", () => {
    const p = parseProject({
      project_id: "job-uuid",
      zones: [{ zone_id: 1, name: "Side yard", work_items: [{ operation: "maintain", material: "lawn", quantity: 900, unit: "sqft" }] }],
    });
    expect(p.zones[0]).toMatchObject({ name: "side_yard", location: null, site_conditions: {}, evidence: [] });
    expect(p.zones[0].work_items[0].subtype).toBeNull();
  });

  it("refuses an unknown operation, unit, a negative amount or a repeated zone", () => {
    const withItem = (item: object) => ({ project_id: 1, zones: [{ zone_id: 1, name: "a", work_items: [item] }] });
    const good = example.zones[0].work_items[0];
    expect(() => parseProject(withItem({ ...good, operation: "paint" }))).toThrow();
    expect(() => parseProject(withItem({ ...good, unit: "furlongs" }))).toThrow();
    expect(() => parseProject(withItem({ ...good, quantity: -1 }))).toThrow();
    expect(() =>
      parseProject({ project_id: 1, zones: [{ zone_id: 1, name: "a" }, { zone_id: 1, name: "b" }] }),
    ).toThrow(/listed twice/);
  });

  it("keeps a zone's site readings and evidence", () => {
    const p = parseProject({
      project_id: 1,
      zones: [{
        zone_id: 1,
        name: "front_mulch_bed",
        site_conditions: { soil_ph: 6.4 },
        evidence: [{ kind: "photo", ref: "job-photos/core.jpg", label: "Core sample photo" }],
      }],
    });
    expect(p.zones[0].site_conditions).toEqual({ soil_ph: 6.4 });
    expect(p.zones[0].evidence[0].label).toBe("Core sample photo");
  });
});

describe("stage 1 MessagePack file", () => {
  it("packs and reads back the same evaluation, numbering every work item", () => {
    const file = unpackStage1(packStage1(example));
    expect(file).toMatchObject({ stage: 1, schema_version: 1, project_id: 1001 });
    expect(file.zones.flatMap((z) => z.work_items.map((i) => i.item_id))).toEqual([1, 2, 3, 4, 5]);
    expect(file.zones[1].work_items[1]).toMatchObject(example.zones[1].work_items[1]);
  });

  it("keeps numbers already given and a work item's measurements", () => {
    const p = parseProject({
      project_id: 1,
      zones: [{
        zone_id: 1,
        name: "a",
        work_items: [
          { item_id: 7, operation: "remove", material: "plant", subtype: "japanese_barberry", quantity: 1, unit: "each",
            measurements: { "Size class": { value: "large", source: "measured" } } },
          { operation: "remove", material: "plant", subtype: "japanese_barberry", quantity: 1, unit: "each" },
        ],
      }],
    });
    const numbered = numberWorkItems(p);
    expect(numbered.zones[0].work_items.map((i) => i.item_id)).toEqual([7, 8]);
    expect(numbered.zones[0].work_items[0].measurements).toEqual({ size_class: { value: "large", source: "measured" } });
  });

  it("refuses a repeated work item number", () => {
    const item = { item_id: 1, operation: "remove", material: "plant", quantity: 1, unit: "each" };
    expect(() => parseProject({ project_id: 1, zones: [{ zone_id: 1, name: "a", work_items: [item, item] }] })).toThrow(/listed twice/);
  });

  it("refuses a file from another stage or version", () => {
    expect(() => unpackStage1(encode({ stage: 2, schema_version: 1, ...example }))).toThrow();
    expect(() => unpackStage1(encode({ stage: 1, schema_version: 9, ...example }))).toThrow();
  });

  it("goes through the database's bytea text and back unchanged", async () => {
    const bytes = packStage1(example);
    const hex = toByteaHex(bytes);
    expect(hex.startsWith("\\x")).toBe(true);
    expect(fromByteaHex(hex)).toEqual(bytes);
    expect(await sha256Hex(bytes)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is smaller than the same thing as JSON", () => {
    expect(packStage1(example).length).toBeLessThan(JSON.stringify(example).length);
  });
});

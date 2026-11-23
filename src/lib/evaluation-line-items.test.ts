import { encode } from "@msgpack/msgpack";
import { describe, expect, it } from "vitest";

import {
  fromByteaHex,
  packStage1,
  parseLineItem,
  sha256Hex,
  toByteaHex,
  toKey,
  unpackStage1,
} from "@/lib/evaluation-line-items";

const mulch = {
  operation: "install",
  material: "mulch",
  subtype: "brown_hardwood",
  quantity: 200,
  unit: "sqft",
  location: "front_bed",
  site_conditions: {},
  evidence: [],
};

describe("parseLineItem", () => {
  it("takes the form's example as it is", () => {
    expect(parseLineItem(mulch)).toEqual(mulch);
  });

  it("tidies words the way the file stores them", () => {
    expect(
      parseLineItem({
        operation: "Install",
        material: "Mulch",
        subtype: "Brown hardwood",
        quantity: "200",
        unit: "Square feet",
        location: "Front bed",
      }),
    ).toEqual(mulch);
    expect(toKey("  Front Bed (left) ")).toBe("front_bed_left");
  });

  it("allows no subtype", () => {
    expect(parseLineItem({ ...mulch, subtype: "" }).subtype).toBeNull();
    expect(parseLineItem({ ...mulch, subtype: undefined }).subtype).toBeNull();
  });

  it("refuses an unknown operation, unit or a negative amount", () => {
    expect(() => parseLineItem({ ...mulch, operation: "paint" })).toThrow();
    expect(() => parseLineItem({ ...mulch, unit: "furlongs" })).toThrow();
    expect(() => parseLineItem({ ...mulch, quantity: -1 })).toThrow();
    expect(() => parseLineItem({ ...mulch, material: "  " })).toThrow();
  });

  it("keeps site readings and evidence", () => {
    const item = parseLineItem({
      ...mulch,
      site_conditions: { soil_ph: 6.4 },
      evidence: [{ kind: "photo", ref: "job-photos/core.jpg", label: "Core sample photo" }],
    });
    expect(item.site_conditions).toEqual({ soil_ph: 6.4 });
    expect(item.evidence[0].label).toBe("Core sample photo");
  });
});

describe("stage 1 MessagePack file", () => {
  it("packs and reads back the same lines", () => {
    const bytes = packStage1("job-1", [mulch, { ...mulch, operation: "remove", material: "sod", subtype: null, unit: "sqft" }]);
    const file = unpackStage1(bytes);
    expect(file).toMatchObject({ stage: 1, schema_version: 1, job_id: "job-1" });
    expect(file.items).toHaveLength(2);
    expect(file.items[0]).toEqual(mulch);
  });

  it("refuses a file from another stage or version", () => {
    expect(() => unpackStage1(encode({ stage: 2, schema_version: 1, job_id: "j", items: [] }))).toThrow();
    expect(() => unpackStage1(encode({ stage: 1, schema_version: 9, job_id: "j", items: [] }))).toThrow();
  });

  it("goes through the database's bytea text and back unchanged", async () => {
    const bytes = packStage1("job-1", [mulch]);
    const hex = toByteaHex(bytes);
    expect(hex.startsWith("\\x")).toBe(true);
    expect(fromByteaHex(hex)).toEqual(bytes);
    expect(await sha256Hex(bytes)).toMatch(/^[0-9a-f]{64}$/);
  });
});

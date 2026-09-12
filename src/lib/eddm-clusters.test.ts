import { describe, expect, it } from "vitest";

import { clusterCells, describeClusters, type UnservedCell } from "@/lib/eddm-clusters";

const cell = (cx: number, cy: number, count: number, sample = "1 SOME ST"): UnservedCell => ({
  cx,
  cy,
  count,
  lat: 39.5 + cy * 0.0014,
  lng: -76.3 + cx * 0.0018,
  sample,
  zip: "21014",
});

describe("clusterCells", () => {
  it("joins touching cells into one development and leaves a lone house alone", () => {
    const clusters = clusterCells([
      cell(10, 10, 6, "100 NEW WAY"),
      cell(11, 10, 9, "120 NEW WAY"),
      cell(11, 11, 4),
      cell(40, 40, 2, "7 OLD LN"),
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toMatchObject({ kind: "development", houses: 19, cells: 3, sample: "120 NEW WAY" });
    expect(clusters[1]).toMatchObject({ kind: "missed_doors", houses: 2, sample: "7 OLD LN" });
  });

  it("calls five together a development and four missed doors", () => {
    expect(clusterCells([cell(0, 0, 5)])[0].kind).toBe("development");
    expect(clusterCells([cell(0, 0, 4)])[0].kind).toBe("missed_doors");
  });

  it("puts the centre where the houses are", () => {
    const [cluster] = clusterCells([cell(0, 0, 1), cell(1, 0, 3)]);
    expect(cluster.lng).toBeGreaterThan(-76.3 + 0.0018 * 0.5);
  });
});

describe("describeClusters", () => {
  it("says what was found", () => {
    const clusters = clusterCells([cell(0, 0, 12), cell(5, 5, 2)]);
    expect(describeClusters(clusters)).toBe("1 likely developments (12 houses) · 1 spots of a few missed doors (2 houses)");
    expect(describeClusters([])).toMatch(/within reach/);
  });
});

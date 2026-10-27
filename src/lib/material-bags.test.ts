import { describe, expect, it } from "vitest";

import { BAG_CY, materialCentsFor, productionService, suggestJob } from "@/lib/forward-pricing";

const topsoil = productionService("topsoil-install")!;
const mulch = productionService("mulch-install")!;

describe("materialCentsFor", () => {
  it("charges a whole bag however little of it is used", () => {
    // 0.01 cu yd of topsoil is still a bag bought at the store.
    expect(materialCentsFor(topsoil, 0.01)).toBe(Math.round(BAG_CY * topsoil.materialCentsPerUnit!));
    expect(materialCentsFor(topsoil, 0.1)).toBe(materialCentsFor(topsoil, 0.01));
  });

  it("rounds up to the next whole bag", () => {
    expect(materialCentsFor(mulch, 0.25)).toBe(Math.round(0.3 * mulch.materialCentsPerUnit!));
  });

  it("charges by the yard once it is ordered in bulk", () => {
    expect(materialCentsFor(mulch, 4.25)).toBe(Math.round(4.25 * mulch.materialCentsPerUnit!));
  });

  it("charges nothing for nothing", () => {
    expect(materialCentsFor(topsoil, 0)).toBe(0);
  });

  it("leaves materials that are not bought by the bag alone", () => {
    const seeding = productionService("seeding")!;
    expect(materialCentsFor(seeding, 18)).toBe(Math.round(18 * seeding.materialCentsPerUnit!));
  });

  it("is what a suggested price charges", () => {
    const lines = suggestJob([
      { typeId: "landscape-bed", serviceName: "Landscape Bed", values: { material: "Mulch", bedWork: "New mulch" }, notes: null, areaSqFt: 5 },
    ]).flat();
    for (const line of lines.filter((l) => l.key === "mulch-install" && l.quantity > 0)) {
      expect(line.materialCents).toBe(materialCentsFor(mulch, line.quantity));
    }
  });
});

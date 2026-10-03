import { describe, expect, it } from "vitest";

import { bringSummary, buildLoadout, leaveBlockedBy, materialKey } from "./loadout";

const tools = [
  { id: "cart", name: "Push sweeper cart", kits: [] },
  { id: "rake", name: "Collapsible Rake", kits: [1, 3] },
  { id: "broom", name: "Push Broom", kits: [3] },
];
const containers = [{ name: "Trash can dolly setup", kits: [1, 2, 3] }];

const devin = {
  sessionId: "s1",
  jobId: "j1",
  customerName: "Devin",
  address: "1 A St",
  kits: [3],
  toolIds: ["cart"],
  materials: ["Grass seed", "Straw"],
};
const toni = { sessionId: "s2", jobId: "j2", customerName: "Toni", address: "2 B St", kits: [3], toolIds: [], materials: [] };
const matthew = {
  sessionId: "s3",
  jobId: "j3",
  customerName: "Matthew",
  address: "3 C St",
  kits: [1],
  toolIds: [],
  materials: ["grass  seed"],
};

describe("buildLoadout", () => {
  it("merges a day's visits into one list, each thing once", () => {
    const out = buildLoadout([devin, toni, matthew], tools, containers, []);
    expect(out.items.map((i) => `${i.kind}:${i.key}`)).toEqual([
      "kit:1",
      "kit:3",
      "tool:cart",
      "material:grass seed",
      "material:straw",
    ]);
    expect(out.total).toBe(5);
    expect(out.complete).toBe(false);
  });

  it("says who each thing is for", () => {
    const out = buildLoadout([devin, toni, matthew], tools, containers, []);
    const kit3 = out.items.find((i) => i.key === "3")!;
    expect(kit3.forStops).toEqual(["Devin", "Toni"]);
    expect(kit3.detail).toContain("trash can dolly setup");
    expect(kit3.detail).toContain("Push Broom");
    const seed = out.items.find((i) => i.key === "grass seed")!;
    expect(seed.forStops).toEqual(["Devin", "Matthew"]);
    expect(seed.label).toBe("Grass seed");
  });

  it("counts the ticks and knows when the truck can go", () => {
    const partly = buildLoadout([devin], tools, containers, [{ kind: "kit", key: "3" }]);
    expect(partly.done).toBe(1);
    expect(leaveBlockedBy(partly)).toBe("3 things on the load-out are not ticked yet.");

    const all = buildLoadout([toni], tools, containers, [{ kind: "kit", key: "3" }]);
    expect(all.complete).toBe(true);
    expect(leaveBlockedBy(all)).toBeNull();
  });

  it("has nothing to tick when nothing was asked for", () => {
    const out = buildLoadout([{ ...toni, kits: [] }], tools, containers, []);
    expect(out.total).toBe(0);
    expect(out.complete).toBe(true);
  });

  it("names a tool that has since been removed rather than crashing", () => {
    const out = buildLoadout([{ ...toni, toolIds: ["gone"] }], tools, containers, []);
    expect(out.items[1].label).toMatch(/deleted/);
  });
});

describe("bringSummary", () => {
  it("reads as one line", () => {
    expect(bringSummary(devin, tools)).toBe("Kit 3, Push sweeper cart, Grass seed, Straw");
    expect(bringSummary({ kits: [], toolIds: [], materials: [] }, tools)).toBeNull();
  });
});

describe("materialKey", () => {
  it("folds case and spacing", () => {
    expect(materialKey("  Grass   Seed ")).toBe("grass seed");
  });
});

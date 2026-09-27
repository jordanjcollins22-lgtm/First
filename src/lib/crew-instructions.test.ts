import { describe, expect, it } from "vitest";

import { crewInstructions } from "@/lib/crew-instructions";

describe("crewInstructions", () => {
  it("says what to do, not what was picked", () => {
    const lines = crewInstructions("landscape-cleanup", { cleanupType: "General", naturalDebris: "Light" });
    expect(lines[0]).toBe("Remove all the leaves, sticks and any debris.");
    expect(lines.join(" ")).not.toMatch(/Cleanup type|General/);
  });

  it("always does the full prep on a bed, whatever was selected", () => {
    const lines = crewInstructions("landscape-bed", { material: "Mulch", weedLevel: "None", edge: "Existing Good Edge" });
    expect(lines).toContain("Clear out all the leaves, sticks and any debris in the bed.");
    expect(lines).toContain("Pull every weed, roots and all.");
    expect(lines.at(-1)).toMatch(/haul away/);
  });

  it("takes all the old stone out when the bed changes material", () => {
    const lines = crewInstructions("landscape-bed", { material: "Mulch", existingMaterial: "Rock", existingMaterialCondition: "Normal" });
    expect(lines).toContain("Take out all the old rock, down to the soil. The bed is changing to mulch.");
  });

  it("counts the bushes when the evaluator gave a number", () => {
    const lines = crewInstructions("landscape-bed", { bushRemoval: "Select Bushes", bushRemoval__qty: "2", material: "Mulch" });
    expect(lines).toContain("Take out 2 bushes, roots and all, and fill the holes.");
  });

  it("uses the evaluator's words for Other", () => {
    const lines = crewInstructions("plant-bush-removal", { type: "Bush", quantity: "1", size: "Large", afterward: "Other", afterward__other: "leave bare for the patio" });
    expect(lines[0]).toBe("Take out the large bush and dig out the root ball.");
    expect(lines).toContain("Afterward: leave bare for the patio.");
  });

  it("falls back to what was noted for a service it has no words for", () => {
    expect(crewInstructions("fire-pit", { size: "Big", size__other: "x" })).toEqual(["Big."]);
  });
});

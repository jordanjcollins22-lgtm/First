import { describe, expect, it } from "vitest";

import { crewInstructions, crewSteps } from "@/lib/crew-instructions";

describe("crewSteps", () => {
  it("puts the clearing in prep, what goes in in the work, and ends with the clean up", () => {
    const steps = crewSteps("landscape-bed", { material: "Mulch", existingMaterial: "Rock", newPlantInstallation: "Select Plants", newPlantInstallation__qty: "3" })!;
    const phases = steps.map((s) => s.phase);
    expect(phases.indexOf("work")).toBeGreaterThan(phases.lastIndexOf("prep"));
    expect(steps.filter((s) => s.phase === "prep").map((s) => s.label)).toContain("Take out all the old rock, down to the soil. The bed is changing to mulch.");
    expect(steps.filter((s) => s.phase === "work").map((s) => s.label)).toContain("Plant the 3 new plants where they're marked, root ball level with the ground, and water them in.");
    expect(steps.at(-1)?.phase).toBe("cleanup");
  });

  it("has no words for a service it doesn't know", () => {
    expect(crewSteps("fire-pit", {})).toBeNull();
  });
});

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
    expect(lines).toContain("Take out the large bush and dig out the root ball.");
    expect(lines).toContain("Afterward: leave bare for the patio.");
  });

  it("falls back to what was noted for a service it has no words for", () => {
    expect(crewInstructions("fire-pit", { size: "Big", size__other: "x" })).toEqual(["Big."]);
  });

  it("reads the answers on a real brush clearing and tree removal", () => {
    const brush = crewInstructions("landscape-cleanup", { cleanupType: "Brush removal", plantsStaying: "No plants", vines: "Heavy", saplings: "Many" });
    expect(brush.join(" ")).not.toMatch(/No plants/);
    expect(brush).toContain("Cut out all the brush, down to the ground, and haul it away.");
    const tree = crewInstructions("plant-bush-removal", { type: "Tree", size: "Large", quantity: "1", afterward: "Just removed" });
    expect(tree).toContain("Take out the large tree and dig out the root ball.");
    expect(tree).toContain("Leave the spot level and raked clean.");
  });
});

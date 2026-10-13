import { describe, expect, it } from "vitest";

import { roleHomes } from "./v2-roles";

describe("roleHomes", () => {
  const projects = { "project-lead": ["lead-home"], "project-technician": ["crew-home"] };

  it("gives each role its own home", () => {
    expect(roleHomes(projects, ["project-technician"])).toEqual(["crew-home"]);
    expect(roleHomes(projects, ["project-lead"])).toEqual(["lead-home"]);
  });

  it("gives a lead who also works on the crew one home, not the same day twice", () => {
    expect(roleHomes(projects, ["project-lead", "project-technician"])).toEqual(["lead-home"]);
  });

  it("gives nothing where the role has no home", () => {
    expect(roleHomes(projects, ["affiliate"])).toEqual([]);
    expect(roleHomes(undefined, ["affiliate"])).toEqual([]);
  });
});

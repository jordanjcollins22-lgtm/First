import { describe, expect, it } from "vitest";

import { findRoleProblems, suggestRoleKey, type PersonForMapping } from "./role-mapping";

const person = (over: Partial<PersonForMapping>): PersonForMapping => ({
  id: over.id ?? "p",
  name: over.name ?? "Pat",
  roles: [],
  isAffiliate: false,
  doesEvaluations: null,
  trialCrew: false,
  payType: "hourly",
  ...over,
});

describe("findRoleProblems", () => {
  it("leaves alone somebody who is only an affiliate", () => {
    expect(findRoleProblems([person({ roles: [], isAffiliate: true })])).toEqual([]);
  });


  it("passes people who hold a RoleKey and nothing odd", () => {
    expect(findRoleProblems([person({ roles: ["admin"] }), person({ roles: ["crew"] }), person({ roles: ["account manager"] })])).toEqual([]);
  });

  it("flags unrecognised and missing roles with a suggested fix", () => {
    const found = findRoleProblems([
      person({ id: "a", name: "Office", roles: ["office"], payType: "both", isAffiliate: true }),
      person({ id: "b", name: "Nobody", roles: [] }),
    ]);
    expect(found.map((f) => f.problem)).toEqual(["unmapped", "unmapped"]);
    expect(found.find((f) => f.profileId === "a")?.fix.add).toEqual(["account manager"]);
    expect(found.find((f) => f.profileId === "b")?.fix.add).toEqual(["crew"]);
  });

  it("swaps a legacy name for the canonical one", () => {
    const [f] = findRoleProblems([person({ roles: ["Foreman"] })]);
    expect(f.problem).toBe("legacy");
    expect(f.fix).toMatchObject({ add: ["project lead"], remove: ["Foreman"] });
  });

  it("does not add a canonical name the person already holds", () => {
    const [f] = findRoleProblems([person({ roles: ["technician", "crew"] })]);
    expect(f.fix).toMatchObject({ add: [], remove: ["technician"] });
  });

  it("flags crew alongside a broader role", () => {
    const [f] = findRoleProblems([person({ roles: ["crew", "account manager"] })]);
    expect(f.problem).toBe("conflict");
    expect(f.fix.remove).toEqual(["crew"]);
  });
});

describe("suggestRoleKey", () => {
  it("prefers what the profile already says", () => {
    expect(suggestRoleKey(person({ trialCrew: true, payType: "commission" }))).toBe("project-technician");
    expect(suggestRoleKey(person({ doesEvaluations: true }))).toBe("evaluator");
    expect(suggestRoleKey(person({ payType: "commission" }))).toBe("account-manager");
  });
});

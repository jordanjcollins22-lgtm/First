import { describe, expect, it } from "vitest";

import {
  isAccountManager,
  isCrew,
  isEvaluator,
  isFieldOnly,
  isOfficeRole,
  qualifiesForAffiliateLink,
} from "@/lib/affiliate-roles";

describe("isFieldOnly", () => {
  it("is true for a crew member", () => {
    expect(isFieldOnly(["crew"])).toBe(true);
  });

  it("is true for a custom field role like Foreman", () => {
    // Somebody given a custom role is still in a truck. Defaulting them into
    // the office view would be the wrong way to be wrong.
    expect(isFieldOnly(["Foreman"])).toBe(true);
  });

  it("is false for anyone holding an office role", () => {
    expect(isFieldOnly(["admin"])).toBe(false);
    expect(isFieldOnly(["crew", "admin"])).toBe(false);
    expect(isFieldOnly(["crew", "Account Manager"])).toBe(false);
    expect(isFieldOnly(["overhead"])).toBe(false);
  });

  it("is false for somebody with no roles at all", () => {
    // Unconfigured, not field-only. Locking them to one screen would hide
    // that nobody has set them up.
    expect(isFieldOnly([])).toBe(false);
  });

  it("matches office roles however they were typed", () => {
    expect(isFieldOnly(["ACCOUNT_MANAGER"])).toBe(false);
    expect(isFieldOnly(["account manager"])).toBe(false);
  });
});

describe("isOfficeRole", () => {
  it("knows the office roles", () => {
    expect(isOfficeRole("admin")).toBe(true);
    expect(isOfficeRole("evaluator")).toBe(true);
    expect(isOfficeRole("crew")).toBe(false);
  });
});

describe("existing role predicates still hold", () => {
  it("matches loosely, as before", () => {
    expect(isEvaluator(["Evaluator"])).toBe(true);
    expect(isAccountManager(["account_manager"])).toBe(true);
    expect(qualifiesForAffiliateLink(["crew"])).toBe(false);
  });
});

describe("isCrew", () => {
  it("matches the role however it was typed", () => {
    expect(isCrew(["crew"])).toBe(true);
    expect(isCrew(["Crew"])).toBe(true);
    expect(isCrew(["CREW"])).toBe(true);
  });

  it("is true for somebody who does both", () => {
    expect(isCrew(["admin", "crew"])).toBe(true);
  });

  it("is false for office-only people", () => {
    expect(isCrew(["admin"])).toBe(false);
    expect(isCrew(["Account Manager"])).toBe(false);
    expect(isCrew([])).toBe(false);
  });
});

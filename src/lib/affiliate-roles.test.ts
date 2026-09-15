import { describe, expect, it } from "vitest";

import {
  canDoEvaluations,
  canOverrideGate,
  canSeeMoney,
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

describe("whose business the money is", () => {
  it("is the owner's, the admin's and whoever keeps the books, however the role is written", () => {
    expect(canSeeMoney(["admin"])).toBe(true);
    expect(canSeeMoney(["Owner"])).toBe(true);
    expect(canSeeMoney(["overhead", "crew"])).toBe(true);
    expect(canSeeMoney(["account manager"])).toBe(false);
    expect(canSeeMoney(["evaluator"])).toBe(false);
    expect(canSeeMoney([])).toBe(false);
  });
});

describe("who may override a failed gate check", () => {
  it("is the people who answer for the job going wrong", () => {
    expect(canOverrideGate(["admin"])).toBe(true);
    expect(canOverrideGate(["owner"])).toBe(true);
    expect(canOverrideGate(["Manager"])).toBe(true);
  });

  it("is not the crew, who raise an issue instead", () => {
    expect(canOverrideGate(["crew"])).toBe(false);
    expect(canOverrideGate(["evaluator"])).toBe(false);
    expect(canOverrideGate([])).toBe(false);
  });
});

describe("who can be sent to do an evaluation", () => {
  it("takes an evaluator", () => {
    expect(canDoEvaluations(["evaluator"])).toBe(true);
  });

  it("takes an account manager, which is what was broken", () => {
    // The public booking page offered only the evaluator role's hours. A
    // business whose evaluator had filled in no availability showed a client a
    // calendar with nothing on it, while an account manager sat there with
    // five days free.
    expect(canDoEvaluations(["account manager"])).toBe(true);
    expect(canDoEvaluations(["Account_Manager"])).toBe(true);
  });

  it("does not send the crew, or somebody with no roles at all", () => {
    expect(canDoEvaluations(["crew"])).toBe(false);
    expect(canDoEvaluations([])).toBe(false);
  });

  it("is the same answer as who gets a booking link", () => {
    for (const roles of [["evaluator"], ["account manager"], ["crew"], ["admin"], []]) {
      expect(canDoEvaluations(roles)).toBe(qualifiesForAffiliateLink(roles));
    }
  });
});

import { describe, expect, it } from "vitest";

import {
  CANONICAL,
  LEGACY_ALIASES,
  canRunJobs,
  canSeeCompanyMoney,
  canSeeJobMoney,
  canSell,
  defaultShowsModule,
  defaultSubtabs,
  hasRole,
  isOwnerLevel,
  isTaskScoped,
  roleKeysOf,
  visibilityFor,
} from "./roles";

describe("reading a role somebody typed", () => {
  it("matches however it was written", () => {
    expect(roleKeysOf(["Project Lead"])).toEqual(["project-lead"]);
    expect(roleKeysOf(["project_lead"])).toEqual(["project-lead"]);
    expect(roleKeysOf(["PROJECT   LEAD"])).toEqual(["project-lead"]);
  });

  it("still knows the names the business already uses", () => {
    // Three people hold "crew" today and must not lose their screens over a
    // renaming.
    expect(roleKeysOf(["crew"])).toEqual(["project-technician"]);
    expect(roleKeysOf(["foreman"])).toEqual(["project-lead"]);
  });

  it("treats admin and manager as owner-level", () => {
    expect(isOwnerLevel(["admin"])).toBe(true);
    expect(isOwnerLevel(["manager"])).toBe(true);
    expect(isOwnerLevel(["owner"])).toBe(true);
  });

  it("grants nothing for a role it does not recognise", () => {
    expect(roleKeysOf(["gambler"])).toEqual([]);
    expect(hasRole(["gambler"], "owner")).toBe(false);
  });

  it("adds several roles together rather than picking one", () => {
    expect(roleKeysOf(["evaluator", "account manager"])).toEqual(["account-manager", "evaluator"]);
  });
});

describe("money is two different questions", () => {
  it("gives the account manager what one job costs, because the client asks them", () => {
    expect(canSeeJobMoney(["account manager"])).toBe(true);
  });

  it("does not give the account manager payroll or the bank", () => {
    expect(canSeeCompanyMoney(["account manager"])).toBe(false);
  });

  it("gives the people running and doing the work neither", () => {
    for (const role of ["project lead", "foreman", "crew", "evaluator"]) {
      expect(canSeeJobMoney([role]), role).toBe(false);
      expect(canSeeCompanyMoney([role]), role).toBe(false);
    }
  });

  it("gives an owner both", () => {
    expect(canSeeJobMoney(["owner"])).toBe(true);
    expect(canSeeCompanyMoney(["owner"])).toBe(true);
  });

  it("keeps overhead on the company side only, as the database does", () => {
    expect(canSeeCompanyMoney(["overhead"])).toBe(true);
  });
});

describe("what somebody may do", () => {
  it("lets the lead run a job without letting them sell it", () => {
    expect(canRunJobs(["project lead"])).toBe(true);
    expect(canSell(["project lead"])).toBe(false);
  });

  it("lets the account manager do both", () => {
    expect(canRunJobs(["account manager"])).toBe(true);
    expect(canSell(["account manager"])).toBe(true);
  });

  it("lets the evaluator do neither", () => {
    expect(canRunJobs(["evaluator"])).toBe(false);
    expect(canSell(["evaluator"])).toBe(false);
  });
});

describe("whose work somebody sees", () => {
  it("keeps a technician to their own", () => {
    expect(isTaskScoped(["crew"])).toBe(true);
    expect(visibilityFor(["crew"]).otherPeoplesWork).toBe(false);
  });

  it("does not narrow somebody who is also something else", () => {
    expect(isTaskScoped(["crew", "account manager"])).toBe(false);
  });

  it("does not narrow somebody with no role, who is unconfigured rather than a technician", () => {
    expect(isTaskScoped([])).toBe(false);
  });
});

describe("what to send, field by field", () => {
  it("gives the lead the work and none of the money", () => {
    const seen = visibilityFor(["project lead"]);
    expect(seen).toMatchObject({
      operationalDetail: true,
      manageJob: true,
      jobMoney: false,
      companyMoney: false,
    });
  });

  it("gives the technician the work and nothing to manage", () => {
    expect(visibilityFor(["crew"])).toMatchObject({ operationalDetail: true, manageJob: false, jobMoney: false });
  });

  it("gives an owner everything", () => {
    expect(visibilityFor(["owner"])).toMatchObject({ jobMoney: true, companyMoney: true, manageJob: true });
  });
});

describe("what a role would see before anybody configures it", () => {
  it("keeps an evaluator out of Marketing and the admin tools", () => {
    expect(defaultShowsModule(["evaluator"], "sales")).toBe(true);
    expect(defaultShowsModule(["evaluator"], "marketing")).toBe(false);
    expect(defaultShowsModule(["evaluator"], "more")).toBe(false);
  });

  it("lands an evaluator on Evaluations, with no Pipeline or Clients beside it", () => {
    expect(defaultSubtabs(["evaluator"], "sales")).toEqual(["evaluations"]);
  });

  it("gives a technician their own day and nothing else", () => {
    expect(defaultShowsModule(["crew"], "jobs")).toBe(false);
    expect(defaultShowsModule(["crew"], "my-day")).toBe(true);
  });

  it("says nothing at all about somebody with no role, rather than locking them out", () => {
    // Unconfigured is not a role. Quietly narrowing them would hide the fact
    // that nobody has set them up.
    expect(defaultShowsModule([], "marketing")).toBe(true);
    expect(defaultSubtabs([], "sales")).toBeNull();
  });

  it("adds two roles together rather than taking the narrower", () => {
    expect(defaultShowsModule(["evaluator", "account manager"], "marketing")).toBe(true);
    // One role with no opinion about a module means the whole module.
    expect(defaultSubtabs(["evaluator", "account manager"], "sales")).toBeNull();
  });
});

describe("the canonical names", () => {
  it("gives Project Lead a name of its own rather than borrowing one", () => {
    expect(CANONICAL["project-lead"]).toEqual(["project lead"]);
    expect(hasRole(["project lead"], "project-lead")).toBe(true);
  });

  it("still answers to what people were called before it existed", () => {
    // Until an admin moves each person across in Settings, nobody loses a
    // screen. Delete LEGACY_ALIASES -- and this test -- when the table is
    // empty in the database.
    expect(LEGACY_ALIASES["project-lead"]).toEqual(["lead", "foreman"]);
    expect(hasRole(["foreman"], "project-lead")).toBe(true);
    expect(hasRole(["technician"], "project-technician")).toBe(true);
  });

  it("keeps admin owner-level, because three people hold it and it is not going anywhere", () => {
    expect(CANONICAL.owner).toContain("admin");
    expect(isOwnerLevel(["admin"])).toBe(true);
    expect(isOwnerLevel(["owner"])).toBe(true);
  });

  it("never lets one name mean two roles", () => {
    const seen = new Map<string, string>();
    for (const [key, names] of Object.entries(CANONICAL)) {
      for (const name of [...names, ...(LEGACY_ALIASES[key as keyof typeof LEGACY_ALIASES] ?? [])]) {
        expect(seen.has(name), `"${name}" is both ${seen.get(name)} and ${key}`).toBe(false);
        seen.set(name, key);
      }
    }
  });
});

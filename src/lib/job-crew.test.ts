import { describe, expect, it } from "vitest";

import {
  assignableAccountManagers,
  assignableProfiles,
  canAssign,
  canMakeLead,
  canUnassign,
  leadAfterRemoval,
  rosterView,
} from "@/lib/job-crew";
import type { JobCrewMember, Profile } from "@/types/domain";

function member(profileId: string, isLead = false, createdAt = "2026-09-01T09:00:00Z"): JobCrewMember {
  return {
    id: `c-${profileId}`,
    job_id: "j1",
    organization_id: "o",
    profile_id: profileId,
    is_lead: isLead,
    added_by: null,
    created_at: createdAt,
  };
}

function profile(id: string, name: string, roles: string[] = ["crew"]): Profile {
  return { id, full_name: name, email: `${id}@x.com`, roles } as unknown as Profile;
}

const PROFILES = [profile("p1", "Zoe Adams"), profile("p2", "Alan Brooks"), profile("p3", "Mia Cole")];

describe("rosterView", () => {
  it("puts the lead first, then alphabetical", () => {
    // A roster that reshuffles between visits is one nobody trusts.
    const view = rosterView([member("p1"), member("p3"), member("p2", true)], PROFILES);
    expect(view.map((v) => v.name)).toEqual(["Alan Brooks", "Mia Cole", "Zoe Adams"]);
    expect(view[0].isLead).toBe(true);
  });

  it("falls back rather than showing a blank name", () => {
    expect(rosterView([member("ghost")], PROFILES)[0].name).toBe("Someone");
  });

  it("is empty for a job with nobody on it", () => {
    expect(rosterView([], PROFILES)).toEqual([]);
  });
});

describe("assignableProfiles", () => {
  it("leaves out anyone already on the job", () => {
    const options = assignableProfiles([member("p2")], PROFILES);
    expect(options.map((p) => p.id)).toEqual(["p3", "p1"]);
  });

  it("offers every crew member when the job is empty", () => {
    expect(assignableProfiles([], PROFILES)).toHaveLength(3);
  });

  it("leaves out anybody without the crew role", () => {
    // The roster decides whose Today screen the job lands on. An office-only
    // person there gets a stop they are never going to drive to.
    const withOffice = [...PROFILES, profile("p4", "Office Only", ["admin"])];
    expect(assignableProfiles([], withOffice).map((p) => p.id)).not.toContain("p4");
  });

  it("keeps somebody who does both", () => {
    const both = [profile("p5", "Both Hats", ["admin", "crew"])];
    expect(assignableProfiles([], both).map((p) => p.id)).toEqual(["p5"]);
  });

  it("matches the role however it was typed", () => {
    const odd = [profile("p6", "Odd Casing", ["Crew"]), profile("p7", "Underscored", ["CREW"])];
    expect(assignableProfiles([], odd)).toHaveLength(2);
  });

  it("offers nobody when nobody holds the crew role", () => {
    expect(assignableProfiles([], [profile("p8", "Admin", ["admin"])])).toEqual([]);
  });
});

describe("canAssign", () => {
  it("adds somebody to live work", () => {
    expect(canAssign("in_progress", [], "p1").ok).toBe(true);
  });

  it("refuses on a cancelled job", () => {
    // Adding them would put a stop on their day for work nobody is doing.
    const verdict = canAssign("cancelled", [], "p1");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/reopen/i);
  });

  it("refuses on a finished job, which would rewrite who did the work", () => {
    const verdict = canAssign("completed", [], "p1");
    expect(verdict.ok === false && verdict.reason).toMatch(/rewrite/i);
  });

  it("refuses to add the same person twice", () => {
    expect(canAssign("approved", [member("p1")], "p1").ok).toBe(false);
  });

  it("refuses somebody without the crew role, even if the page offered them", () => {
    // Checked as well as filtered, so a stale page cannot route around it.
    const verdict = canAssign("approved", [], "p4", { roles: ["admin"] } as unknown as Profile);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/crew role/i);
  });

  it("accepts somebody who holds crew alongside an office role", () => {
    expect(
      canAssign("approved", [], "p5", { roles: ["admin", "crew"] } as unknown as Profile).ok
    ).toBe(true);
  });

  it("still allows the call when no candidate was supplied", () => {
    // The roles check is opt-in so callers that already know stay simple.
    expect(canAssign("approved", [], "p1").ok).toBe(true);
  });
});

describe("canUnassign", () => {
  it("takes somebody off live work", () => {
    expect(canUnassign("in_progress", [member("p1")], "p1").ok).toBe(true);
  });

  it("allows removing the last person, because a job between crews is real", () => {
    // Refusing would mean swapping a crew always required add-then-remove.
    expect(canUnassign("approved", [member("p1")], "p1").ok).toBe(true);
  });

  it("refuses on a finished job", () => {
    expect(canUnassign("completed", [member("p1")], "p1").ok).toBe(false);
  });

  it("refuses for somebody who was never on it", () => {
    expect(canUnassign("approved", [member("p1")], "p2").ok).toBe(false);
  });
});

describe("canMakeLead", () => {
  it("promotes somebody already on the job", () => {
    expect(canMakeLead("approved", [member("p1"), member("p2", true)], "p1").ok).toBe(true);
  });

  it("refuses for somebody not on the job yet", () => {
    const verdict = canMakeLead("approved", [], "p1");
    expect(verdict.ok === false && verdict.reason).toMatch(/add them/i);
  });

  it("refuses to promote the current lead again", () => {
    expect(canMakeLead("approved", [member("p1", true)], "p1").ok).toBe(false);
  });

  it("refuses on a closed job", () => {
    expect(canMakeLead("completed", [member("p1")], "p1").ok).toBe(false);
    expect(canMakeLead("cancelled", [member("p1")], "p1").ok).toBe(false);
  });
});

describe("leadAfterRemoval", () => {
  it("hands the lead to the longest-serving of whoever is left", () => {
    // A job with people on it is never unassigned — blanking the lead would
    // drop it out of every list that filters on assignment.
    const crew = [
      member("p1", true, "2026-09-01T09:00:00Z"),
      member("p2", false, "2026-09-02T09:00:00Z"),
      member("p3", false, "2026-09-03T09:00:00Z"),
    ];
    expect(leadAfterRemoval(crew, "p1")).toBe("p2");
  });

  it("leaves an existing lead alone when somebody else goes", () => {
    const crew = [member("p1", true), member("p2")];
    expect(leadAfterRemoval(crew, "p2")).toBe("p1");
  });

  it("is nobody when the last person is removed", () => {
    expect(leadAfterRemoval([member("p1", true)], "p1")).toBeNull();
  });
});

describe("assignableAccountManagers", () => {
  it("offers only people with the account manager role", () => {
    const people = [
      profile("p1", "Zoe Adams", ["crew"]),
      profile("p2", "Alan Brooks", ["Account Manager"]),
      profile("p3", "Mia Cole", ["admin"]),
    ];
    expect(assignableAccountManagers(people).map((p) => p.id)).toEqual(["p2"]);
  });

  it("includes somebody who runs crews and accounts both", () => {
    const people = [profile("p1", "Both Hats", ["crew", "account_manager"])];
    expect(assignableAccountManagers(people)).toHaveLength(1);
  });

  it("sorts by name so the picker reads the same every time", () => {
    const people = [
      profile("p1", "Zoe Adams", ["account manager"]),
      profile("p2", "Alan Brooks", ["account manager"]),
    ];
    expect(assignableAccountManagers(people).map((p) => p.full_name)).toEqual([
      "Alan Brooks",
      "Zoe Adams",
    ]);
  });

  it("offers nobody when nobody holds the role", () => {
    expect(assignableAccountManagers([profile("p1", "Crew Only", ["crew"])])).toEqual([]);
  });
});

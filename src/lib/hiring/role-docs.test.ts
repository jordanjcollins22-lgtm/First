import { describe, expect, it } from "vitest";

import { ROLE_DOCS, cultureFor, roleDocFor } from "@/lib/hiring/role-docs";
import { OPEN_POSITIONS } from "@/lib/hiring/positions";

describe("role docs", () => {
  it("cover every open job", () => {
    for (const p of OPEN_POSITIONS) expect(roleDocFor(p.key)).not.toBeNull();
  });

  it("each have the Four Rs, a perfect day, a 30-60-90 plan and task checklists", () => {
    for (const doc of Object.values(ROLE_DOCS)) {
      for (const list of [doc.roles, doc.responsibilities, doc.requirements, doc.results, doc.perfectDay, doc.tasks]) expect(list.length).toBeGreaterThan(0);
      expect(doc.plan.map((m) => m.day)).toEqual([30, 60, 90]);
      expect(new Set(doc.tasks.map((t) => t.key)).size).toBe(doc.tasks.length);
    }
  });

  it("has nothing for closed jobs", () => {
    expect(roleDocFor("project-lead")).toBeNull();
    expect(roleDocFor(null)).toBeNull();
  });
});

describe("cultureFor", () => {
  it("gives each job the same five values with its own examples", () => {
    const tech = cultureFor("project-technician");
    const affiliate = cultureFor("affiliate");
    expect(affiliate.map((c) => c.value)).toEqual(tech.map((c) => c.value));
    expect(affiliate[0].looksLike).toContain("Only send people we can really help");
    expect(tech[0].looksLike).toContain("blows off the driveway");
  });
});

describe("affiliate onboarding from anywhere", () => {
  it("plans the first two weeks and time seeing the rest of the business, all remote", () => {
    const doc = ROLE_DOCS.affiliate;
    expect(doc.remote).toBe(true);
    expect(doc.firstTwoWeeks?.map((d) => d.when)).toEqual(["Day 1", "Day 2", "Day 3", "Day 4", "Day 5", "Week 2"]);
    expect(doc.seeTheBusiness?.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify([doc.firstTwoWeeks, doc.seeTheBusiness]).toLowerCase()).not.toMatch(/in person|ride-along|project lead/);
  });
});

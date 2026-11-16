import { describe, expect, it } from "vitest";

import { ROLE_DOCS, roleDocFor } from "@/lib/hiring/role-docs";
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

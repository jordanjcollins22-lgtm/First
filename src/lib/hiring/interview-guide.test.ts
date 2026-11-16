import { describe, expect, it } from "vitest";

import { interviewGuide } from "@/lib/hiring/interview-guide";
import { CULTURE } from "@/lib/hiring/role-docs";

describe("interview guide", () => {
  it("covers background, competence, every value and the first months in the first interview", () => {
    const g = interviewGuide("affiliate", "interview")!;
    expect(g.map((s) => s.key)).toEqual(["background", "competence", "values", "first-months"]);
    const values = g.find((s) => s.key === "values")!;
    expect(values.ask).toHaveLength(CULTURE.length);
    for (const c of CULTURE) expect(values.ask.some((q) => q.startsWith(c.value))).toBe(true);
    expect(g.find((s) => s.key === "first-months")!.say!.some((l) => l.startsWith("By day 90"))).toBe(true);
  });

  it("says the hard parts and what gets someone let go on the owner call", () => {
    const g = interviewGuide("affiliate", "owner_talk")!;
    expect(g.map((s) => s.key)).toEqual(["values", "hard-parts", "let-go", "their-questions"]);
    expect(g.find((s) => s.key === "hard-parts")!.say!.join(" ")).toContain("commission only");
  });

  it("never promises free work", () => {
    for (const call of ["interview", "owner_talk"] as const) {
      const text = JSON.stringify(interviewGuide("affiliate", call)).toLowerCase();
      expect(text).not.toMatch(/free estimate|it's free/);
    }
  });

  it("has no guide yet for the other jobs", () => {
    expect(interviewGuide("project-technician", "interview")).toBeNull();
  });
});

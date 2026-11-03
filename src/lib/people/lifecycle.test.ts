import { describe, expect, it } from "vitest";

import {
  addBusinessDays,
  assignmentEligibility,
  dashboardCounts,
  itemsForPerson,
  lifecycleForApplicant,
  missingForNext,
  nextAction,
  nextStage,
  type MoveFacts,
  type TemplateLike,
} from "./lifecycle";
import { STARTER_MODULES, STARTER_TEMPLATES } from "./content";
import { SOPS } from "./sops";

const facts = (over: Partial<MoveFacts>): MoveFacts => ({ stage: "onboarding", status: "active", hasProfile: true, items: [], assignments: [], competencies: [], ...over });
const assignment = { title: "Mulch", required: true, read_at: "x", shown_at: "x", showed_back_at: "x", taught_at: "x", competency_key: "mulch" };

describe("moving through the lifecycle", () => {
  it("holds someone until the requirements are done, whatever the date", () => {
    const items = [{ label: "Form I-9", required: true, done_at: null, stage: "onboarding" }];
    expect(missingForNext(facts({ items }))).toEqual(["Form I-9"]);
    expect(missingForNext(facts({ items: [{ ...items[0], done_at: "x" }] }))).toEqual([]);
  });
  it("ignores optional items and other stages", () => {
    expect(missingForNext(facts({ items: [{ label: "Optional", required: false, done_at: null, stage: "onboarding" }, { label: "Later", required: true, done_at: null, stage: "training" }] }))).toEqual([]);
  });
  it("needs an app account before leaving onboarding", () => {
    expect(missingForNext(facts({ hasProfile: false }))).toEqual(["App account linked"]);
  });
  it("needs the whole training SOP, ending with teaching it", () => {
    expect(missingForNext(facts({ stage: "training", assignments: [{ ...assignment, taught_at: null }] }))).toEqual(["Mulch: they can teach it"]);
  });
  it("needs a verified competency to leave evaluation", () => {
    expect(missingForNext(facts({ stage: "evaluation", assignments: [assignment] }))).toEqual(["Mulch: pass the evaluation"]);
    expect(missingForNext(facts({ stage: "evaluation", assignments: [assignment], competencies: ["mulch"] }))).toEqual([]);
  });
  it("leaves pre-hire moves to Hiring", () => {
    expect(nextStage("interview")).toBeNull();
    expect(nextStage("onboarding")).toBe("training");
    expect(nextStage("deployment")).toBe("performance_management");
  });
  it("says what is next", () => {
    expect(nextAction(facts({ stage: "interview" }))).toBe("Complete the interview scorecard.");
    expect(nextAction(facts({}))).toBe("Ready to move to Training.");
  });
});

describe("matching Hiring", () => {
  it("maps every application stage", () => {
    expect(lifecycleForApplicant("needs_review")).toEqual({ stage: "screening", status: "active" });
    expect(lifecycleForApplicant("offer").stage).toBe("job_offer");
    expect(lifecycleForApplicant("hired").stage).toBe("onboarding");
    expect(lifecycleForApplicant("not_a_fit").status).toBe("declined");
  });
});

describe("eligibility", () => {
  it("keeps people off jobs until onboarded, and supervised until evaluated", () => {
    expect(assignmentEligibility("onboarding", "active").level).toBe("none");
    expect(assignmentEligibility("training", "active").level).toBe("supervised");
    expect(assignmentEligibility("evaluation", "active").level).toBe("supervised");
    expect(assignmentEligibility("performance_management", "active").level).toBe("unsupervised");
    expect(assignmentEligibility("deployment", "offboarded").level).toBe("none");
  });
});

describe("checklists", () => {
  const t = (over: Partial<TemplateLike>): TemplateLike => ({ stage: "onboarding", item_key: "a", part: "compliance", label: "A", required: true, legal: false, positions: [], applies_to: "any", due_days: null, due_business_days: null, sort: 0, active: true, ...over });
  it("filters by position and classification, and dates the item", () => {
    const list = [t({ item_key: "i9", applies_to: "employee", due_business_days: 3 }), t({ item_key: "w9", applies_to: "contractor" }), t({ item_key: "lead", positions: ["project-lead"] })];
    const out = itemsForPerson(list, { stage: "onboarding", position: "project-technician", classification: "employee" }, "2026-11-05");
    expect(out.map((i) => i.item_key)).toEqual(["i9"]);
    expect(out[0].due_on).toBe("2026-11-10");
  });
  it("skips weekends", () => {
    expect(addBusinessDays("2026-10-15", 3)).toBe("2026-10-20");
  });
});

describe("starter content", () => {
  it("covers every reusable checklist the document names", () => {
    const stages = new Set(STARTER_TEMPLATES.map((t) => t.stage));
    for (const s of ["application", "screening", "interview", "job_offer", "onboarding", "training", "evaluation", "deployment", "performance_management", "offboarding"]) expect(stages.has(s as never)).toBe(true);
  });
  it("has all five onboarding parts", () => {
    const parts = new Set(STARTER_TEMPLATES.filter((t) => t.stage === "onboarding").map((t) => t.part));
    expect([...parts].sort()).toEqual(["check_back", "clarity", "compliance", "connection", "culture"]);
  });
  it("uses unique keys", () => {
    const keys = STARTER_TEMPLATES.map((t) => `${t.stage}.${t.item_key}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(STARTER_MODULES.map((m) => m.module_key)).size).toBe(STARTER_MODULES.length);
  });
  it("gives each module the ten parts", () => {
    for (const m of STARTER_MODULES) {
      expect(m.title && m.purpose && m.practice).toBeTruthy();
      expect(m.steps.length).toBeGreaterThan(0);
      expect(m.criteria.length).toBeGreaterThan(0);
    }
  });
  it("keeps the mulch example word for word, with the 2 inch depth", () => {
    const mulch = STARTER_MODULES.find((m) => m.module_key === "mulch-installation");
    expect(mulch?.steps).toHaveLength(11);
    expect(mulch?.steps[5]).toContain("2 inches");
  });
  it("writes every SOP in the same eleven-part format", () => {
    expect(SOPS.length).toBeGreaterThanOrEqual(10);
    for (const s of SOPS) for (const k of ["name", "definition", "purpose", "owner", "trigger", "inputs", "procedure", "standards", "completion", "exceptions", "next"] as const) expect(s[k].length).toBeGreaterThan(0);
  });
});

describe("dashboard", () => {
  it("counts each pile", () => {
    const counts = dashboardCounts([
      { stage: "screening", status: "active", applicantStage: "video_submitted", overdue: 0, openEvaluation: false, needsAttention: false },
      { stage: "training", status: "active", overdue: 1, openEvaluation: false, needsAttention: true },
      { stage: "evaluation", status: "active", overdue: 0, openEvaluation: true, needsAttention: false },
      { stage: "onboarding", status: "offboarded", overdue: 0, openEvaluation: false, needsAttention: true },
    ]);
    expect(counts.awaitingScreening).toBe(1);
    expect(counts.inTraining).toBe(1);
    expect(counts.evaluationsPending).toBe(1);
    expect(counts.awaitingOnboarding).toBe(0);
    expect(counts.requiringAttention).toBe(1);
  });
});

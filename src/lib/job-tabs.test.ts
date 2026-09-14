import { describe, expect, it } from "vitest";

import { JOB_TABS, sectionsForTab, sectionVisibleAtStage, tabOfSection, tabVisibleAtStage, unplacedSections } from "./job-tabs";

// The panels the job page renders today. If one is added or renamed, the
// last test here fails rather than the panel quietly vanishing from the page.
const LIVE_SECTIONS = [
  "map",
  "proposal",
  "schedule",
  "photos",
  "walkthrough",
  "review",
  "visits",
  "crew",
  "payment",
  "invoice",
  "messages",
  "marketing",
  "request",
].map((id) => ({ id }));

describe("the job's headings", () => {
  it("is the ten the brief asks for", () => {
    expect(JOB_TABS).toHaveLength(10);
    expect(JOB_TABS[0].key).toBe("overview");
    expect(JOB_TABS[1].key).toBe("field");
  });

  it("never puts a panel under two headings", () => {
    const all = JOB_TABS.flatMap((tab) => tab.sections);
    expect(new Set(all).size).toBe(all.length);
  });

  it("places every panel the page renders", () => {
    expect(unplacedSections(LIVE_SECTIONS)).toEqual([]);
  });

  it("knows which heading a panel is under", () => {
    expect(tabOfSection("map")).toBe("site");
    expect(tabOfSection("invoice")).toBe("billing");
    expect(tabOfSection("nonsense")).toBeNull();
  });
});

describe("what a heading shows", () => {
  it("lists its panels in the order the heading gives, not the page's", () => {
    expect(sectionsForTab(LIVE_SECTIONS, "plan").map((s) => s.id)).toEqual(["schedule", "crew", "visits"]);
  });

  it("leaves out a panel the page did not render, rather than showing a hole", () => {
    expect(sectionsForTab([{ id: "payment" }], "billing").map((s) => s.id)).toEqual(["payment"]);
  });

  it("is empty for the headings that are their own screen", () => {
    expect(sectionsForTab(LIVE_SECTIONS, "overview")).toEqual([]);
    expect(sectionsForTab(LIVE_SECTIONS, "field")).toEqual([]);
  });
});

describe("what a job shows at each stage", () => {
  it("shows a booked evaluation only what an evaluation needs", () => {
    const visible = JOB_TABS.map((tab) => tab.key).filter((key) => tabVisibleAtStage("evaluation", key));
    expect(visible).toEqual(["overview", "field", "site", "scope", "plan", "photos", "messages"]);
    // The schedule panel stays, because that is where the visit is moved or cancelled.
    expect(sectionVisibleAtStage("evaluation", "schedule")).toBe(true);
    for (const id of ["proposal", "read", "visits", "crew", "payment", "invoice", "walkthrough", "review", "marketing"]) {
      expect(sectionVisibleAtStage("evaluation", id), id).toBe(false);
    }
  });

  it("opens pricing once the evaluation is in, and the rest once it is sold and underway", () => {
    expect(sectionVisibleAtStage("pricing", "proposal")).toBe(true);
    expect(tabVisibleAtStage("pricing", "billing")).toBe(false);
    expect(tabVisibleAtStage("scheduled", "billing")).toBe(true);
    expect(tabVisibleAtStage("scheduled", "closeout")).toBe(false);
    expect(tabVisibleAtStage("working", "closeout")).toBe(true);
    expect(JOB_TABS.every((tab) => tabVisibleAtStage("done", tab.key))).toBe(true);
  });

  it("places every live panel at some stage, so none can be added and lost", () => {
    for (const { id } of LIVE_SECTIONS) {
      expect(sectionVisibleAtStage("done", id), id).toBe(true);
    }
  });
});


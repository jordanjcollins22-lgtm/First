import { describe, expect, it } from "vitest";

import { JOB_TABS, sectionsForTab, tabOfSection, unplacedSections } from "./job-tabs";

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

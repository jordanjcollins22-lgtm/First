import { describe, expect, it } from "vitest";

import { cleanHeardAbout, heardAboutSummary } from "./heard-about";

describe("cleanHeardAbout", () => {
  it("keeps an answer from the list", () => {
    expect(cleanHeardAbout("nextdoor", "ignored")).toEqual({ heard_about: "nextdoor", heard_about_detail: null });
  });

  it("keeps Other's words, trimmed and short", () => {
    expect(cleanHeardAbout("other", "  the fair  ")).toEqual({ heard_about: "other", heard_about_detail: "the fair" });
    expect(cleanHeardAbout("other", "x".repeat(200)).heard_about_detail).toHaveLength(80);
  });

  it("drops anything not on the list", () => {
    expect(cleanHeardAbout("tv", null)).toEqual({ heard_about: null, heard_about_detail: null });
    expect(cleanHeardAbout(undefined, undefined)).toEqual({ heard_about: null, heard_about_detail: null });
  });
});

describe("heardAboutSummary", () => {
  it("counts visits and signed work per answer, busiest first, with the unasked last", () => {
    const lines = heardAboutSummary([
      { heard_about: "google", status: "approved" },
      { heard_about: "google", status: "estimating" },
      { heard_about: "nextdoor", status: "completed" },
      { heard_about: null, status: "quoted" },
      { heard_about: "bogus", status: "in_progress" },
    ]);
    expect(lines).toEqual([
      { value: "google", label: "Google", booked: 2, signed: 1 },
      { value: "nextdoor", label: "Nextdoor", booked: 1, signed: 1 },
      { value: "none", label: "Not asked", booked: 2, signed: 1 },
    ]);
  });
});

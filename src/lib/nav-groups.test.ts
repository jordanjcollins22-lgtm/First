import { describe, expect, it } from "vitest";
import { TABS } from "./permissions";
import {
  isPrimary,
  moreTabs,
  NOT_A_DESTINATION,
  placedKeys,
  PRIMARY_HREF,
  PRIMARY_LABEL,
  PRIMARY_ORDER,
  primaryNav,
  REACHED_VIA,
} from "./nav-groups";

const everything = TABS.map((t) => t.key);

describe("the structure", () => {
  it("gives every page a place, so nothing can go missing", () => {
    // The guard behind the whole idea. A page added later has to land
    // somewhere -- promoted to the eight, reached through one of them, or in
    // the More drawer. Falling through would make it unreachable, which is
    // the one thing this restructure must never do.
    const placed = placedKeys();
    const homeless = everything.filter((key) => !placed.has(key));
    expect(homeless, `Pages with nowhere to live: ${homeless.join(", ")}`).toEqual([]);
  });

  it("names and points every primary entry somewhere", () => {
    for (const key of PRIMARY_ORDER) {
      expect(PRIMARY_LABEL[key], `${key} has no label`).toBeTruthy();
      expect(PRIMARY_HREF[key], `${key} has no href`).toBeTruthy();
    }
  });

  it("keeps every primary entry a real registered page", () => {
    // A nav entry for a tab that does not exist is a permission nobody can
    // grant and a link that cannot be gated.
    for (const key of PRIMARY_ORDER) {
      expect(everything, `${key} is not in TABS`).toContain(key);
    }
  });

  it("does not list a page in two places", () => {
    // Two doors to one room is how a clean nav grows back into seventeen
    // entries.
    for (const key of Object.keys(REACHED_VIA)) {
      expect(isPrimary(key), `${key} is both primary and reached via another`).toBe(false);
    }
    // With everything granted, nothing reached through a primary page is
    // listed separately -- that only happens when its page is out of reach.
    const inMore = moreTabs(everything).map((t) => t.key);
    for (const key of inMore) {
      expect(isPrimary(key)).toBe(false);
      expect(REACHED_VIA[key]).toBeUndefined();
    }
  });

  it("points everything reached through another page at a primary one", () => {
    for (const [key, via] of Object.entries(REACHED_VIA)) {
      expect(isPrimary(via), `${key} is reached via ${via}, which is not primary`).toBe(true);
    }
  });
});

describe("primaryNav", () => {
  it("shows only what somebody is allowed into", () => {
    expect(primaryNav(["pipeline", "contacts"]).map((n) => n.key)).toEqual([
      "contacts",
      "pipeline",
    ]);
  });

  it("keeps the order fixed rather than following what was granted", () => {
    // The nav should be in the same place for everybody who has it, so
    // somebody helping a colleague can say "third one down".
    const nav = primaryNav([...everything].reverse());
    expect(nav.map((n) => n.key)).toEqual([...PRIMARY_ORDER]);
  });

  it("gives nothing to somebody with no grants", () => {
    expect(primaryNav([])).toEqual([]);
  });

  it("calls the proposals entry what you actually arrive at", () => {
    const entry = primaryNav(["proposals"])[0];
    expect(entry.label).toMatch(/invoices/i);
    expect(entry.href).toBe("/proposals");
  });
});

describe("moreTabs", () => {
  it("holds the tools nobody named, and only those", () => {
    const keys = moreTabs(everything).map((t) => t.key);
    expect(keys).toContain("payments");
    expect(keys).toContain("knowledge-graph");
    expect(keys).toContain("leads");
    expect(keys).not.toContain("pipeline");
    expect(keys).not.toContain("invoices");
  });

  it("leaves out the pages you land on rather than go to", () => {
    // Nobody navigates to "Job Detail" -- they open a job.
    const keys = moreTabs(everything).map((t) => t.key);
    for (const key of NOT_A_DESTINATION) expect(keys).not.toContain(key);
  });

  it("gives a door to a grant whose only page they were not given", () => {
    // The orphan problem. Somebody allowed Invoices but not Proposals used to
    // have the permission and no way to use it, because the only door was a
    // page they could not open.
    expect(moreTabs(["invoices"]).map((t) => t.key)).toEqual(["invoices"]);
    expect(moreTabs(["weather"]).map((t) => t.key)).toEqual(["weather"]);
  });

  it("does not double it up once they have the page it lives on", () => {
    expect(moreTabs(["invoices", "proposals"]).map((t) => t.key)).toEqual([]);
    expect(moreTabs(["weather", "evaluations"]).map((t) => t.key)).toEqual([]);
  });

  it("shows a person only their own", () => {
    expect(moreTabs(["payments"]).map((t) => t.key)).toEqual(["payments"]);
    expect(moreTabs(["pipeline"])).toEqual([]);
  });

  it("is in alphabetical order", () => {
    const labels = moreTabs(everything).map((t) => t.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });
});

import { describe, expect, it } from "vitest";

import {
  canOpenSubtab,
  MODULES,
  MOVED,
  moduleFor,
  navModules,
  openingSubtab,
  REACHED_VIA_MORE,
  subtabsFor,
  unplacedTabKeys,
} from "./modules";
import { TABS, UNGOVERNED_ROUTES } from "./permissions";

const ADMIN = TABS.map((t) => t.key);

describe("the six modules", () => {
  it("is six, and stays six", () => {
    // The brief's whole point: another primary entry is a decision, not a
    // side effect of adding a page.
    expect(MODULES).toHaveLength(6);
  });

  it("names each one after a question rather than a table", () => {
    for (const mod of MODULES) {
      expect(mod.question.endsWith("?"), `${mod.key} has no question`).toBe(true);
      expect(mod.subtabs.length).toBeGreaterThan(0);
    }
  });

  it("gives every subtab a key unique within its module, because the key is in the URL", () => {
    for (const mod of MODULES) {
      const keys = mod.subtabs.map((s) => s.key);
      expect(new Set(keys).size, `${mod.key} repeats a subtab key`).toBe(keys.length);
    }
  });

  it("only ever names permission keys that exist", () => {
    const real = new Set(TABS.map((t) => t.key));
    for (const mod of MODULES) {
      for (const subtab of mod.subtabs) {
        for (const key of subtab.tabs) {
          expect(real.has(key), `${mod.key}/${subtab.key} names "${key}", which is not a permission`).toBe(true);
        }
      }
    }
  });

  it("places every page somewhere, so nothing goes missing in the move", () => {
    expect(unplacedTabKeys()).toEqual([]);
  });
});

describe("who sees what", () => {
  it("shows an admin every module", () => {
    expect(navModules(ADMIN).map((m) => m.key)).toEqual([
      "my-day",
      "sales",
      "schedule",
      "jobs",
      "marketing",
      "more",
    ]);
  });

  it("leaves out a module with nothing open inside it", () => {
    // Somebody with only the pipeline: Sales opens, Marketing does not.
    const keys = navModules(["pipeline"]).map((m) => m.key);
    expect(keys).toContain("sales");
    expect(keys).not.toContain("marketing");
    expect(keys).not.toContain("more");
  });

  it("always keeps My Day, which is the viewer's own work", () => {
    expect(navModules([]).map((m) => m.key)).toEqual(["my-day"]);
  });

  it("opens a shared page on the half somebody is allowed", () => {
    // Granted Materials but not Tools: Inventory still opens.
    expect(subtabsFor("more", ["materials"]).map((s) => s.key)).toEqual(["inventory"]);
  });

  it("takes any one of a subtab's keys as enough", () => {
    const print = moduleFor("marketing")!.subtabs.find((s) => s.key === "print")!;
    expect(canOpenSubtab(print, ["flyer"])).toBe(true);
    expect(canOpenSubtab(print, ["door-hangers"])).toBe(true);
    expect(canOpenSubtab(print, ["social"])).toBe(false);
  });

  it("does not gate what is the viewer's own", () => {
    const today = moduleFor("my-day")!.subtabs.find((s) => s.key === "today")!;
    expect(canOpenSubtab(today, [])).toBe(true);
  });
});

describe("which subtab a link opens", () => {
  it("opens the one asked for", () => {
    expect(openingSubtab("sales", ADMIN, "clients")).toBe("clients");
  });

  it("falls back to the first one they can open, not a refusal", () => {
    expect(openingSubtab("sales", ["contacts"], "pipeline")).toBe("clients");
  });

  it("is nothing at all when they can open none of it", () => {
    expect(openingSubtab("marketing", ["pipeline"], null)).toBeNull();
  });

  it("ignores a made-up tab in a typed URL", () => {
    expect(openingSubtab("sales", ADMIN, "../admin")).toBe("pipeline");
  });
});

describe("old addresses", () => {
  it("sends every moved page to a subtab that exists", () => {
    for (const [from, to] of Object.entries(MOVED)) {
      // Settings is not a module: it hangs off the admin role rather than a
      // tab, for the reason permissions.ts gives.
      if (to === "/admin/settings") continue;
      const [path, query] = to.split("?");
      const mod = moduleFor(path.replace("/", ""));
      expect(mod, `${from} goes to ${to}, which is not a module`).not.toBeNull();
      const asked = new URLSearchParams(query).get("tab");
      expect(
        mod!.subtabs.some((s) => s.key === asked),
        `${from} goes to ${to}, and "${asked}" is not one of ${mod!.key}'s subtabs`
      ).toBe(true);
    }
  });

  it("does not move a page that has to keep its own address", () => {
    // Public links and printed sheets are in the world -- on a proposal
    // somebody emailed, on a sticker on a saw. They never move.
    for (const from of Object.keys(MOVED)) {
      expect(UNGOVERNED_ROUTES[from], `${from} is exempt and should not be moved`).toBeUndefined();
    }
    for (const from of ["/book", "/proposal/[token]", "/w/[code]", "/i/[code]", "/progress/[token]"]) {
      expect(MOVED[from]).toBeUndefined();
    }
  });

  it("never sends a page to itself", () => {
    for (const [from, to] of Object.entries(MOVED)) {
      expect(to.split("?")[0]).not.toBe(from);
    }
  });

  it("never redirects a page that More links to, which would be a loop", () => {
    // More lists these and links to them. A redirect from one into More is a
    // door that opens onto itself.
    for (const path of Object.keys(REACHED_VIA_MORE)) {
      expect(MOVED[path], `${path} is both a More destination and a redirect`).toBeUndefined();
    }
  });

  it("puts every More destination under a group that exists", () => {
    const groups = new Set(moduleFor("more")!.subtabs.map((s) => s.key));
    for (const [path, group] of Object.entries(REACHED_VIA_MORE)) {
      expect(groups.has(group), `${path} is filed under "${group}", which More has no group for`).toBe(true);
    }
  });
});

describe("everything in More can actually be clicked", () => {
  it("gives every group at least one page to open", () => {
    // The More page used to keep a second, hand-written list of what each
    // group contained, beside the modules. It went stale exactly the way a
    // second list of anything does: Fleet, Subscriptions, Transactions and
    // Client messaging had no link anywhere, and a group whose pages all
    // resolved to nothing vanished from the screen. Somebody with every
    // permission granted still could not reach them.
    const everything = TABS.map((tab) => tab.key);
    for (const subtab of subtabsFor("more", everything)) {
      expect(
        subtab.tabs.length,
        `the ${subtab.label} group opens nothing, so it will not render`
      ).toBeGreaterThan(0);
      for (const key of subtab.tabs) {
        expect(
          everything.includes(key),
          `${subtab.label} opens "${key}", which is not a registered tab`
        ).toBe(true);
      }
    }
  });

  it("puts every module's subtab behind tabs that exist", () => {
    const keys = new Set(TABS.map((tab) => tab.key));
    for (const mod of MODULES) {
      for (const subtab of mod.subtabs) {
        for (const key of subtab.tabs) {
          expect(keys.has(key), `${mod.label} → ${subtab.label} names "${key}"`).toBe(true);
        }
      }
    }
  });
});

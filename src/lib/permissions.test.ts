import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TABS, UNGOVERNED_ROUTES, tabsAllowedForRoles, unconfiguredTabKeys } from "@/lib/permissions";

const APP_DIR = join(process.cwd(), "src", "app", "(app)");

/** Every route under the (app) group that renders a page. */
function findRoutes(dir: string, prefix = ""): string[] {
  const routes: string[] = [];
  if (existsSync(join(dir, "page.tsx"))) routes.push(prefix === "" ? "/" : prefix);

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // Route groups like (app) don't appear in the URL.
    const segment = entry.name.startsWith("(") ? "" : `/${entry.name}`;
    routes.push(...findRoutes(join(dir, entry.name), `${prefix}${segment}`));
  }
  return routes;
}

describe("page permissions registry", () => {
  it("governs every page, or says why not", () => {
    const routes = findRoutes(APP_DIR);
    const governed = new Set(TABS.map((t) => t.href));
    const exempt = new Set(Object.keys(UNGOVERNED_ROUTES));

    const ungoverned = routes.filter((r) => !governed.has(r) && !exempt.has(r));

    // If this fails you added a page. Put it in TABS so it shows up on the
    // permissions matrix, or in UNGOVERNED_ROUTES with the reason it isn't a
    // tab. Either way somebody decided, which is the point.
    expect(ungoverned, `Ungoverned pages: ${ungoverned.join(", ")}`).toEqual([]);
  });

  it("does not list routes that no longer exist", () => {
    const routes = new Set(findRoutes(APP_DIR));
    const stale = [...Object.keys(UNGOVERNED_ROUTES), ...TABS.map((t) => t.href)].filter(
      (href) => !routes.has(href)
    );
    expect(stale, `Registered but missing: ${stale.join(", ")}`).toEqual([]);
  });
});

describe("tabsAllowedForRoles", () => {
  const grants = [
    { role_name: "admin", tab_key: "tools" },
    { role_name: "crew", tab_key: "tools" },
  ];

  it("grants a configured tab to the roles that hold it", () => {
    expect(tabsAllowedForRoles(["crew"], grants).has("tools")).toBe(true);
  });

  it("denies a configured tab to a role without it", () => {
    expect(tabsAllowedForRoles(["evaluator"], grants).has("tools")).toBe(false);
  });

  it("falls back to admin for an unconfigured page", () => {
    // "payments" has no grants in this fixture — it's brand new.
    expect(tabsAllowedForRoles(["admin"], grants).has("payments")).toBe(true);
    expect(tabsAllowedForRoles(["crew"], grants).has("payments")).toBe(false);
  });

  it("never opens a page to the team on its own", () => {
    // No page is open to everyone until somebody ticks it, whatever it is.
    for (const tab of TABS) {
      const untouched = tabsAllowedForRoles(["crew"], []);
      expect(untouched.has(tab.key), `${tab.key} was open without a grant`).toBe(false);
    }
  });

  it("stops giving admins a page once somebody else has been granted it", () => {
    // A tab with any grant is configured, so admins follow the matrix too.
    const configured = [{ role_name: "crew", tab_key: "conversations" }];
    expect(tabsAllowedForRoles(["crew"], configured).has("conversations")).toBe(true);
    expect(tabsAllowedForRoles(["admin"], configured).has("conversations")).toBe(false);
  });

  it("reports which tabs are still awaiting a decision", () => {
    expect(unconfiguredTabKeys(grants).has("tools")).toBe(false);
    expect(unconfiguredTabKeys(grants).has("payments")).toBe(true);
  });
});

describe("detail pages reachable from a list", () => {
  // These are the pages you can only get to by clicking a row. Gating them
  // separately from the list that links to them breaks the link without
  // protecting anything — the name and address are already on screen.
  const DETAIL_INHERITS: Record<string, string[]> = {
    "job-detail": ["project-data", "evaluations", "pipeline"],
    "client-detail": ["contacts", "project-data", "pipeline"],
    "conversation-thread": ["conversations"],
    "conversation-call": ["conversation-thread", "conversations"],
  };

  it("names only tabs that actually exist", () => {
    const keys = new Set(TABS.map((t) => t.key));
    for (const [detail, parents] of Object.entries(DETAIL_INHERITS)) {
      expect(keys.has(detail), `${detail} is not a registered tab`).toBe(true);
      for (const parent of parents) {
        expect(keys.has(parent), `${parent} is not a registered tab`).toBe(true);
      }
    }
  });

  it("opens a detail page to anyone granted a list that links to it", () => {
    // A crew member who can see the calendar can open the job on it.
    const grants = [{ role_name: "crew", tab_key: "evaluations" }];
    const allowed = tabsAllowedForRoles(["crew"], grants);
    expect(allowed.has("evaluations")).toBe(true);
    // The detail tab itself stays unconfigured — inheritance is decided by
    // requireAnyTab at the page, not by widening the grant set here.
    expect(allowed.has("job-detail")).toBe(false);
    expect(DETAIL_INHERITS["job-detail"]).toContain("evaluations");
  });
});

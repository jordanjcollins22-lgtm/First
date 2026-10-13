import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { V2_GROUPS } from "@/lib/data/v2";

/**
 * A job a loader builds but no group names is never shown. The loaders need
 * a database to run, so the jobs are read from the source: every pillar is
 * written `id: "…", label: "…"`, inside the loader for its page.
 */
const source = readFileSync(join(__dirname, "v2.ts"), "utf8");
const LOADERS = { marketing: "loadMarketing", sales: "loadSales", operations: "loadOperations", admin: "loadAdmin" } as const;

function pillarIds(fn: string): string[] {
  const start = source.indexOf(`export async function ${fn}(`);
  const end = source.indexOf("\nexport ", start + 1);
  // "overview" is the helper every page shares, not a job of its own.
  return [...source.slice(start, end).matchAll(/id: "([a-z-]+)", label: "/g)].map((m) => m[1]).filter((id) => id !== "overview");
}

describe("the few choices on each page", () => {
  for (const [key, fn] of Object.entries(LOADERS) as [keyof typeof LOADERS, string][]) {
    it(`places every ${key} job in a group, once`, () => {
      const ids = pillarIds(fn);
      expect(ids.length).toBeGreaterThan(0);
      const placed = V2_GROUPS[key].flatMap((g) => g.ids).filter((id) => id !== "overview");
      expect([...placed].sort()).toEqual([...new Set(ids)].sort());
    });
  }

  it("keeps Marketing to digital and physical", () => {
    expect(V2_GROUPS.marketing.map((g) => g.label)).toEqual(["Digital marketing", "Physical marketing"]);
  });

  it("gives Sales and Operations each one Automated messages choice", () => {
    expect(V2_GROUPS.sales.find((g) => g.id === "messages")?.ids).toEqual(["messages"]);
    expect(V2_GROUPS.operations.find((g) => g.id === "messages")?.ids).toEqual(["opsmessages"]);
  });
});

describe("what each person sees", () => {
  it("gives each role exactly the pages that have something for it", async () => {
    const { V2_ROLE_PAGES } = await import("@/lib/v2-roles");
    const pagesWith = new Map<string, Set<string>>();
    for (const [key, fn] of Object.entries(LOADERS)) {
      const start = source.indexOf(`export async function ${fn}(`);
      const end = source.indexOf("\nexport ", start + 1);
      for (const m of source.slice(start, end).matchAll(/id: "([a-z-]+)", label: "[^"]*", kind: "[^"]*", who: \[([^\]]*)\]/g)) {
        if (m[1] === "overview" && key !== "admin") continue; // only Admin keeps its overview
        for (const role of m[2].match(/[a-z-]+/g) ?? []) {
          if (!pagesWith.has(role)) pagesWith.set(role, new Set());
          pagesWith.get(role)!.add(key);
        }
      }
    }
    // A role's own home screen on a choice counts as something for it too.
    for (const [key, groups] of Object.entries(V2_GROUPS)) {
      for (const g of groups) {
        for (const role of Object.keys(g.rolePanels ?? {})) {
          if (!pagesWith.has(role)) pagesWith.set(role, new Set());
          pagesWith.get(role)!.add(key);
        }
      }
    }
    for (const [role, pages] of Object.entries(V2_ROLE_PAGES)) {
      expect([...pages].sort(), role).toEqual([...(pagesWith.get(role) ?? [])].sort());
    }
  });
});

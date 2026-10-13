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

  it("gathers Sales' reminders and follow-ups into one choice", () => {
    expect(V2_GROUPS.sales.find((g) => g.id === "messages")?.ids).toEqual(["reminders", "followup"]);
  });
});

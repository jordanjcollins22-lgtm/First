import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The secrets module never reaches a browser.
 *
 * lib/env.ts holds every key the server has. A component marked "use
 * client" that imports it is a bundle that could, one refactor later,
 * carry a secret to somebody's phone. Browser code takes what it needs
 * from lib/public-env.ts, which holds only what is public by design.
 */
function files(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files(path, found);
    else if (/\.(ts|tsx)$/.test(entry.name)) found.push(path);
  }
  return found;
}

describe("secrets stay on the server", () => {
  it("lets no browser component import lib/env", () => {
    const offenders = files("src").filter((path) => {
      const source = readFileSync(path, "utf8");
      return /^\s*["']use client["']/.test(source) && /from ["']@\/lib\/env["']/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("keeps every public setting behind a NEXT_PUBLIC_ name and nothing else", () => {
    const source = readFileSync("src/lib/public-env.ts", "utf8");
    const names = [...source.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => name.startsWith("NEXT_PUBLIC_"))).toBe(true);
  });
});

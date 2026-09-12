import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A "use server" file may only export async functions.
 *
 * Everything else in one is rewritten into a reference to a server action, so
 * a constant exported from one arrives in the browser as something that is not
 * what it looks like. An array of MIME types came back with no `.join` on it
 * and took a whole page down on render, with nothing at build time and nothing
 * in the types to say why.
 *
 * Nothing catches this: it typechecks, it lints, and it builds. So it is
 * checked here, by reading the files.
 */

const ROOT = join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

const serverFiles = walk(ROOT).filter((path) => {
  const head = readFileSync(path, "utf8").slice(0, 200);
  return /^\s*["']use server["']/.test(head);
});

/** Exported values, ignoring types — a type is erased and cannot be misused. */
function exportedValues(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/^export\s+(?!type\b|interface\b)(\w+)\s+(\w+)?/gm)) {
    const [, keyword, name] = match;
    if (keyword === "async" || keyword === "function") continue;
    if (keyword === "const" || keyword === "let" || keyword === "var" || keyword === "class") {
      names.push(name ?? keyword);
    }
  }
  return names;
}

describe("every 'use server' file", () => {
  it("finds the ones there are, so this test cannot pass by looking at nothing", () => {
    expect(serverFiles.length).toBeGreaterThan(5);
  });

  for (const path of serverFiles) {
    const relative = path.slice(ROOT.length + 1);

    it(`${relative} exports only async functions`, () => {
      const source = readFileSync(path, "utf8");
      const values = exportedValues(source);
      expect(
        values,
        `${relative} exports ${values.join(", ")} as a value. Move constants to a plain module — ` +
          "a non-function export from a server file becomes an action reference in the browser."
      ).toEqual([]);
    });

    it(`${relative} declares every exported function async`, () => {
      const source = readFileSync(path, "utf8");
      const sync = Array.from(source.matchAll(/^export\s+function\s+(\w+)/gm)).map((m) => m[1]);
      expect(sync, `${relative} exports ${sync.join(", ")} without async`).toEqual([]);
    });
  }
});

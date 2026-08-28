import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every layout that owns an <html> owns its own stylesheet.
 *
 * A root layout outside the (app) group inherits nothing from it. The flyer
 * page found this out in front of a customer: it shipped with no CSS at all,
 * so a local business opening the link we had just texted them got serif
 * body text and a raw "Choose File" button.
 *
 * The failure is invisible in development if you only ever look at a page
 * inside (app), and invisible in a type check, and invisible in every unit
 * test. So it is checked here, against the files themselves.
 */
function layoutFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) layoutFiles(path, found);
    else if (entry.name === "layout.tsx") found.push(path);
  }
  return found;
}

const LAYOUTS = layoutFiles("src/app");

describe("public route layouts", () => {
  it("finds the layouts at all, so this test cannot pass by looking at nothing", () => {
    expect(LAYOUTS.length).toBeGreaterThan(2);
  });

  it("imports the stylesheet in every layout that renders its own html", () => {
    for (const file of LAYOUTS) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("<html")) continue;
      expect(source, `${file} renders <html> but imports no stylesheet`).toMatch(
        /import\s+["'].*globals\.css["']/
      );
    }
  });

  it("covers the pages a customer opens", () => {
    // Named outright: these three are the ones sent to people outside the
    // business, where an unstyled page costs a job rather than a shrug.
    for (const path of ["src/app/proposal/layout.tsx", "src/app/flyer/layout.tsx", "src/app/book/layout.tsx"]) {
      expect(LAYOUTS, path).toContain(path);
    }
  });
});

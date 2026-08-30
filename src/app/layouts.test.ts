import { describe, expect, it } from "vitest";

import { isPublic, PUBLIC_PREFIXES, needsAuthCheck} from "@/lib/supabase/middleware";
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

describe("routes a customer opens", () => {
  /**
   * A page outside the (app) group is one we send to somebody with no
   * account. It has to be let past the sign-in redirect as well as given its
   * own stylesheet, and the flyer page proved what happens when only one of
   * those is remembered: we texted local businesses a link that took them
   * straight to a staff sign-in screen.
   */
  const TOP_LEVEL = readdirSync("src/app", { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("(") && e.name !== "api")
    .map((e) => `/${e.name}`);

  it("finds the public route folders", () => {
    expect(TOP_LEVEL).toContain("/flyer");
    expect(TOP_LEVEL).toContain("/proposal");
    expect(TOP_LEVEL).toContain("/book");
  });

  it("lets every one of them past the sign-in redirect", () => {
    for (const route of TOP_LEVEL) {
      expect(isPublic(route), `${route} redirects to sign-in`).toBe(true);
      expect(isPublic(`${route}/anything`), `${route}/anything redirects to sign-in`).toBe(true);
    }
  });

  it("still guards everything else", () => {
    for (const path of ["/dashboard", "/admin/flyer", "/jobs/abc", "/", "/leads"]) {
      expect(isPublic(path), `${path} is open to anybody`).toBe(false);
    }
  });

  it("does not open a path that merely starts with a public word", () => {
    // "/bookkeeping" is not "/book".
    expect(isPublic("/bookkeeping")).toBe(false);
    expect(isPublic("/flyers-admin")).toBe(false);
  });

  it("keeps the sign-in page itself reachable", () => {
    expect(PUBLIC_PREFIXES).toContain("/login");
    expect(isPublic("/login")).toBe(true);
  });
});

describe("public pages do not wait on the auth server", () => {
  it("asks nobody about a page we hand to a customer", () => {
    // decideAccess allows a public path whoever is asking, so the call was a
    // round trip to Supabase on every load of a prerendered booking page.
    for (const pathname of ["/book", "/book/options", "/proposal/abc", "/flyer", "/login"]) {
      expect(needsAuthCheck(pathname)).toBe(false);
    }
  });

  it("still asks about everything behind the sign-in", () => {
    for (const pathname of ["/dashboard", "/jobs/123", "/pipeline", "/admin/settings", "/"]) {
      expect(needsAuthCheck(pathname)).toBe(true);
    }
  });

  it("agrees with the public list it is derived from", () => {
    // Two ways of saying the same thing is how the flyer page ended up
    // behind a staff sign-in screen.
    for (const prefix of PUBLIC_PREFIXES) {
      expect(needsAuthCheck(prefix)).toBe(!isPublic(prefix));
    }
  });
});

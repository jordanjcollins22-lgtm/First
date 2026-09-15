import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * A table the app reads as a signed-in person must let them read it.
 *
 * Row security with no policy is not an error anybody sees. It is an empty
 * result. The bank tables had security switched on and no policy at all,
 * deliberately, back when only a background job read them — and three screens
 * were later built on top of those rows. They shipped, looked finished, and
 * told the owner no transactions had ever come through while six months of
 * them sat in the table.
 *
 * Nothing in a type check or a unit test can see that, because the fault lives
 * in the database. So it is checked here, against the migrations: if the app
 * reads a table through the signed-in client, and a migration switches row
 * security on for that table, some migration has to grant a policy on it too.
 */
const MIGRATIONS = "supabase/migrations";
const SOURCE = "src";

/** Files that read as the signed-in person, not as the service role. */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, found);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) found.push(path);
  }
  return found;
}

const SQL = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => readFileSync(join(MIGRATIONS, file), "utf8"))
  .join("\n");

/** Tables some migration switches row security on. */
function secured(): Set<string> {
  const found = new Set<string>();
  for (const match of SQL.matchAll(
    /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s+enable\s+row\s+level\s+security/gi
  )) {
    found.add(match[1].toLowerCase());
  }
  return found;
}

/** Tables some migration grants a policy on. */
function withPolicy(): Set<string> {
  const found = new Set<string>();
  for (const match of SQL.matchAll(
    /create\s+policy\s+[\s\S]{0,120}?\son\s+(?:public\.)?"?([a-z0-9_]+)"?/gi
  )) {
    found.add(match[1].toLowerCase());
  }
  return found;
}

/**
 * Tables read through the signed-in client.
 *
 * A file that builds the admin client is doing so on purpose and runs as the
 * service role, which does not consult policies at all — so it is skipped
 * whole rather than picked apart line by line.
 */
function readByPeople(): Map<string, string> {
  const tables = new Map<string, string>();
  for (const file of sourceFiles(SOURCE)) {
    const source = readFileSync(file, "utf8");
    if (!source.includes('from "@/lib/supabase/server"')) continue;
    if (source.includes("createAdminClient")) continue;
    for (const match of source.matchAll(/\.from\(\s*["']([a-z0-9_]+)["']\s*\)/gi)) {
      const table = match[1].toLowerCase();
      if (!tables.has(table)) tables.set(table, file);
    }
  }
  return tables;
}

describe("row security covers what the app reads", () => {
  const SECURED = secured();
  const POLICIED = withPolicy();
  const READ = readByPeople();

  it("finds the migrations and the reads, so this cannot pass on nothing", () => {
    expect(SECURED.size).toBeGreaterThan(20);
    expect(POLICIED.size).toBeGreaterThan(20);
    expect(READ.size).toBeGreaterThan(20);
  });

  it("gives a policy to every secured table the app reads as a person", () => {
    const locked: string[] = [];
    for (const [table, file] of READ) {
      if (!SECURED.has(table)) continue;
      if (POLICIED.has(table)) continue;
      locked.push(`${table} (read in ${file})`);
    }

    // A table in this list returns nothing at all to a signed-in person, with
    // no error anywhere. Either grant it a policy, or read it through the
    // admin client on purpose.
    expect(locked, `Secured with no policy: ${locked.join(", ")}`).toEqual([]);
  });

  it("keeps the access token out of reach", () => {
    // bank_links holds the Plaid token. It has no policy and must never get
    // one; nothing a browser can reach has any business with it.
    expect(POLICIED.has("bank_links")).toBe(false);
    expect(READ.has("bank_links")).toBe(false);
  });
});

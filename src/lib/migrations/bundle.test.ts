import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MIGRATION_BUNDLE } from "@/lib/migrations/bundle";

/**
 * The bundle is generated. These tests exist so a migration added without
 * re-running the script fails here rather than showing somebody a Database
 * setup page that quietly omits the thing they are missing.
 */
describe("migration bundle", () => {
  it("matches the files on disk, byte for byte", () => {
    for (const migration of MIGRATION_BUNDLE) {
      const onDisk = readFileSync(join(process.cwd(), "supabase/migrations", migration.file), "utf8");
      expect(migration.sql, `${migration.file} has drifted — re-run scripts/build-migration-bundle.mjs`).toBe(
        onDisk
      );
    }
  });

  it("is in migration order", () => {
    const files = MIGRATION_BUNDLE.map((m) => m.file);
    expect(files).toEqual([...files].sort());
  });

  it("names a table for every migration that creates one", () => {
    // A migration whose tables aren't listed can never be detected as missing.
    for (const migration of MIGRATION_BUNDLE) {
      const createsTable = /create table if not exists (\w+)/.exec(migration.sql);
      if (createsTable) {
        expect(migration.creates, `${migration.file} creates ${createsTable[1]} but lists no tables`).toContain(
          createsTable[1]
        );
      }
    }
  });

  it("carries real SQL, not empty strings", () => {
    for (const migration of MIGRATION_BUNDLE) {
      expect(migration.sql.length, migration.file).toBeGreaterThan(100);
    }
  });
});

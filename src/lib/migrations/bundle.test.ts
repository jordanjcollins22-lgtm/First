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

describe("column probes", () => {
  it("names a column for every migration that adds one", () => {
    // Without this an ALTER-only migration is assumed applied whenever its
    // neighbours are, which is the wrong answer for exactly the migrations
    // most likely to be outstanding. A setup page that says the database is
    // up to date while a column a client's payment needs is missing is worse
    // than no page at all.
    for (const migration of MIGRATION_BUNDLE) {
      if (!/alter\s+table\s+\w+\s+add\s+column/i.test(migration.sql)) continue;
      expect(migration.adds.length, `${migration.file} adds a column but names none`).toBeGreaterThan(0);
    }
  });

  it("writes every probe as table.column", () => {
    for (const migration of MIGRATION_BUNDLE) {
      for (const ref of migration.adds) {
        expect(ref, `${migration.file}: ${ref}`).toMatch(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/);
      }
    }
  });

  it("can tell whether the payment columns have been run", () => {
    // The ones standing between an accepted proposal and a paid one. Named
    // outright because "the page probes something" is not the same as "the
    // page probes this".
    const paths = MIGRATION_BUNDLE.find((m) => m.file === "0124_acceptance_payment_path.sql");
    expect(paths?.adds).toContain("job_proposals.payment_path");
    const day = MIGRATION_BUNDLE.find((m) => m.file === "0125_client_chosen_day.sql");
    expect(day?.adds).toContain("job_proposals.client_chosen_day");
  });
});

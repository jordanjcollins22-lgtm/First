import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import { MIGRATION_BUNDLE, type BundledMigration } from "@/lib/migrations/bundle";

export interface MigrationStatus extends BundledMigration {
  applied: boolean;
}

/**
 * Which migrations have actually been run, by asking the database.
 *
 * There is no migrations table to consult — these are applied by hand in the
 * SQL editor — so this probes for the tables each one creates. A migration
 * that creates no table (an ALTER-only one) is reported as applied when the
 * migrations around it are, which is the best that can be told from here and
 * is flagged as such on the page.
 */
export async function checkSchema(): Promise<MigrationStatus[]> {
  const supabase = await createClient();

  const results: MigrationStatus[] = [];
  let lastKnown = true;

  for (const migration of MIGRATION_BUNDLE) {
    if (migration.creates.length === 0) {
      results.push({ ...migration, applied: lastKnown });
      continue;
    }

    // head:true so this costs a lookup rather than a table scan.
    const checks = await Promise.all(
      migration.creates.map(async (table) => {
        const { error } = await supabase
          .from(table as never)
          .select("*", { count: "exact", head: true })
          .limit(1);
        return !isMissingTable(error);
      })
    );

    const applied = checks.every(Boolean);
    lastKnown = applied;
    results.push({ ...migration, applied });
  }

  return results;
}

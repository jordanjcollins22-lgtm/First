import { createClient } from "@/lib/supabase/server";
import { isMissingColumn, isMissingTable } from "@/lib/setup-errors";
import { MIGRATION_BUNDLE, type BundledMigration } from "@/lib/migrations/bundle";

export interface MigrationStatus extends BundledMigration {
  applied: boolean;
}

/**
 * Which migrations have actually been run, by asking the database.
 *
 * There is no migrations table to consult — these are applied by hand in the
 * SQL editor — so each migration is probed for what it should have left
 * behind: the tables it creates, and the columns it adds.
 *
 * The columns matter more than they look. An ALTER-only migration creates no
 * table, so it used to be reported as applied whenever its neighbours were,
 * and that is the wrong answer for exactly the migrations most likely to be
 * outstanding. A page that says the database is up to date while the column
 * a client's payment needs is missing is worse than no page.
 *
 * Only a migration with nothing at all to probe for still falls back to its
 * neighbours, and the page says so.
 */
export async function checkSchema(): Promise<MigrationStatus[]> {
  const supabase = await createClient();

  const results: MigrationStatus[] = [];
  let lastKnown = true;

  for (const migration of MIGRATION_BUNDLE) {
    if (migration.creates.length === 0 && migration.adds.length === 0) {
      results.push({ ...migration, applied: lastKnown });
      continue;
    }

    // head:true so this costs a lookup rather than a table scan.
    const tableChecks = migration.creates.map(async (table) => {
      const { error } = await supabase
        .from(table as never)
        .select("*", { count: "exact", head: true })
        .limit(1);
      return !isMissingTable(error);
    });

    // Naming the column is what makes this a real check: selecting "*" would
    // succeed against a table that is missing every column the migration was
    // supposed to add.
    const columnChecks = migration.adds.map(async (ref) => {
      const [table, column] = ref.split(".");
      if (!table || !column) return true;
      const { error } = await supabase
        .from(table as never)
        .select(column, { count: "exact", head: true })
        .limit(1);
      // A missing table means an earlier migration is outstanding, not this
      // one, but either way this migration cannot have been applied.
      return !isMissingColumn(error) && !isMissingTable(error);
    });

    const checks = await Promise.all([...tableChecks, ...columnChecks]);
    const applied = checks.every(Boolean);
    lastKnown = applied;
    results.push({ ...migration, applied });
  }

  return results;
}

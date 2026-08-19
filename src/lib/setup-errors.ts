/**
 * Turning "the migration hasn't been run" into something actionable.
 *
 * PostgREST answers a request for a table that does not exist with
 * "Could not find the table 'public.x' in the schema cache", which is
 * technically accurate and useless to the person reading it. They do not have
 * a schema cache problem; they have a migration they haven't run yet, and the
 * only thing worth telling them is which one.
 */

/** Which migration file creates what. Keep in step with supabase/migrations. */
const TABLE_MIGRATIONS: Record<string, string> = {
  lead_prospects: "0076_lead_prospects.sql",
  ledger_entries: "0077_job_lifecycle_and_ledger.sql",
  job_photos: "0078_job_completion_photos.sql",
  job_work_sessions: "0080_sessions_and_tickets.sql",
  job_tickets: "0080_sessions_and_tickets.sql",
  job_walkthroughs: "0081_final_walkthrough.sql",
  crew_day_events: "0082_crew_day.sql",
  job_crew: "0083_job_crew.sql",
};

interface DbError {
  message?: string;
  code?: string;
}

/**
 * Whether this error means a table is missing rather than a request being
 * wrong. PostgREST uses PGRST205 for an unknown table and Postgres 42P01 for
 * an undefined relation; the message check catches older shapes.
 */
export function isMissingTable(error: DbError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  const message = error.message ?? "";
  return /schema cache/i.test(message) || /relation .* does not exist/i.test(message);
}

/**
 * A message worth showing somebody.
 *
 * Falls back to the raw message when it is not a missing-table error, because
 * a genuine failure should not be dressed up as a setup step.
 */
export function describeDbError(error: DbError | null | undefined, fallback = "Something went wrong."): string {
  if (!error) return fallback;
  if (!isMissingTable(error)) return error.message ?? fallback;

  const table = Object.keys(TABLE_MIGRATIONS).find((name) =>
    (error.message ?? "").includes(name)
  );
  const migration = table ? TABLE_MIGRATIONS[table] : null;

  return migration
    ? `This feature needs its database migration. In Supabase's SQL Editor, run supabase/migrations/${migration}, then reload.`
    : "This feature needs its database migration run in Supabase's SQL Editor.";
}

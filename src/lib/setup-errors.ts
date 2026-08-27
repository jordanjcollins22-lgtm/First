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
  outreach_channels: "0084_outreach.sql",
  outreach_touches: "0084_outreach.sql",
  job_observers: "0086_job_observers.sql",
  org_counters: "0089_job_numbers_and_pipeline.sql",
  contact_merges: "0091_contact_merge_undo.sql",
  target_markets: "0092_target_markets.sql",
  knowledge_nodes: "0093_knowledge_graph.sql",
  knowledge_relationships: "0093_knowledge_graph.sql",
  knowledge_units: "0100_units_outputs_and_fees.sql",
  inventory_codes: "0103_inventory_codes_and_movements.sql",
  inventory_movements: "0103_inventory_codes_and_movements.sql",
  flyer_ad_spots: "0104_flyer_ad_spots.sql",
  social_posts: "0105_social_posts.sql",
  door_hanger_slots: "0108_door_hangers.sql",
  job_photo_waivers: "0112_photo_waivers.sql",
  time_entries: "0113_time_clock.sql",
  job_photo_marks: "0114_photo_review.sql",
  rank_keywords: "0110_rank_grid.sql",
  rank_scans: "0110_rank_grid.sql",
  rank_points: "0110_rank_grid.sql",
};

/**
 * Which migration adds what column.
 *
 * Needed because most migrations after the first few add columns rather than
 * tables, and PostgREST reports a missing column with the same "schema cache"
 * wording as a missing table. Without this the app correctly worked out that a
 * migration was missing and then could not say which — which is the half that
 * was worth saying.
 *
 * Keyed on column name alone. Two tables could in principle both gain a column
 * called "source", so the table is checked too where the message carries it.
 */
const COLUMN_MIGRATIONS: { column: string; table?: string; migration: string }[] = [
  { column: "referral_note", table: "outreach_touches", migration: "0087_referral_outcome.sql" },
  { column: "in_target_market", table: "lead_prospects", migration: "0087_referral_outcome.sql" },
  { column: "contact_type", table: "customers", migration: "0088_contact_types.sql" },
  { column: "external_id", table: "customers", migration: "0088_contact_types.sql" },
  { column: "import_batch", table: "customers", migration: "0088_contact_types.sql" },
  { column: "import_address", table: "customers", migration: "0088_contact_types.sql" },
  { column: "do_not_contact", table: "customers", migration: "0088_contact_types.sql" },
  { column: "job_number", table: "jobs", migration: "0089_job_numbers_and_pipeline.sql" },
  { column: "pipeline_stage", table: "customers", migration: "0089_job_numbers_and_pipeline.sql" },
  { column: "opportunity_value", table: "customers", migration: "0089_job_numbers_and_pipeline.sql" },
  { column: "pipeline", table: "customers", migration: "0089_job_numbers_and_pipeline.sql" },
  { column: "scheduled_for", table: "knowledge_nodes", migration: "0094_knowledge_schedule.sql" },
  { column: "recurrence", table: "knowledge_nodes", migration: "0094_knowledge_schedule.sql" },
  { column: "times_done", table: "knowledge_nodes", migration: "0094_knowledge_schedule.sql" },
  { column: "unit", table: "knowledge_nodes", migration: "0095_knowledge_costs.sql" },
  { column: "quantity", table: "knowledge_relationships", migration: "0095_knowledge_costs.sql" },
  { column: "material_id", table: "knowledge_nodes", migration: "0096_knowledge_inventory_link.sql" },
  { column: "tool_id", table: "knowledge_nodes", migration: "0098_knowledge_tool_link.sql" },
  { column: "cost_basis", table: "knowledge_nodes", migration: "0099_cost_basis.sql" },
  { column: "fixed_cost", table: "knowledge_nodes", migration: "0100_units_outputs_and_fees.sql" },
  { column: "output_per_unit", table: "knowledge_nodes", migration: "0100_units_outputs_and_fees.sql" },
  { column: "run_size", table: "knowledge_nodes", migration: "0100_units_outputs_and_fees.sql" },
  { column: "kind", table: "materials", migration: "0101_inventory_kind_resale_steps.sql" },
  { column: "resale_value", migration: "0101_inventory_kind_resale_steps.sql" },
  { column: "step_order", table: "knowledge_relationships", migration: "0101_inventory_kind_resale_steps.sql" },
  { column: "duration_hours", table: "knowledge_nodes", migration: "0102_node_time_and_rate.sql" },
  { column: "hourly_rate", table: "knowledge_nodes", migration: "0102_node_time_and_rate.sql" },
  { column: "category", table: "materials", migration: "0096_knowledge_inventory_link.sql" },
];

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
 * Whether a column is missing rather than a whole table.
 *
 * PostgREST uses PGRST204 and Postgres 42703, and both report it with the same
 * "schema cache" wording a missing table gets — so this is checked first when
 * working out which migration to name.
 */
export function isMissingColumn(error: DbError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST204" || error.code === "42703") return true;
  const message = error.message ?? "";
  return /could not find the '.*' column/i.test(message) || /column .* does not exist/i.test(message);
}

/** The migration that would fix this error, or null when nothing matches. */
export function migrationFor(error: DbError | null | undefined): string | null {
  const message = error?.message ?? "";
  if (!message) return null;

  const column = COLUMN_MIGRATIONS.find(
    (c) => message.includes(c.column) && (!c.table || message.includes(c.table))
  );
  if (column) return column.migration;

  const table = Object.keys(TABLE_MIGRATIONS).find((name) => message.includes(name));
  return table ? TABLE_MIGRATIONS[table] : null;
}

/**
 * A message worth showing somebody.
 *
 * Falls back to the raw message when it is not a missing-table error, because
 * a genuine failure should not be dressed up as a setup step.
 */
export function describeDbError(error: DbError | null | undefined, fallback = "Something went wrong."): string {
  if (!error) return fallback;

  // The database's own double-booking guard. It fires only when a write got
  // past the app's checks, and its message already names the person, the job
  // and the hours — so it is passed through with the prefix stripped rather
  // than replaced with something vaguer.
  const doubleBooked = (error.message ?? "").match(/Double booking: (.+)$/);
  if (doubleBooked) return doubleBooked[1];

  if (!isMissingTable(error) && !isMissingColumn(error)) return error.message ?? fallback;

  const migration = migrationFor(error);

  return migration
    ? `This feature needs its database migration. In Supabase's SQL Editor, run supabase/migrations/${migration}, then reload. Database setup has a copy button.`
    : `This feature needs a database migration that hasn't been run. Open Database setup to see which ones are outstanding. (${error.message ?? "no detail"})`;
}

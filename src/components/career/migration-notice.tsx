/** Shown until the career tracker's table exists. */
export function CareerMigrationNotice() {
  return (
    <p className="mb-5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
      The career tracker needs its database table first. In Supabase&apos;s SQL Editor, run{" "}
      <code>supabase/migrations/0392_career_tracker.sql</code>, then reload this page. Until then nothing
      here can be saved.
    </p>
  );
}

import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { checkSchema } from "@/lib/data/schema-check";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { MigrationRunner } from "@/components/admin/migration-runner";

/**
 * Which migrations still need running, and the SQL to run them.
 *
 * Applying one by hand from a phone otherwise means finding the file on
 * GitHub, selecting several hundred lines, and switching apps without losing
 * the clipboard. Admin-only, and gated on the role directly rather than on a
 * permissions tab — the tab list lives in the database this page exists to
 * repair.
 */
export default async function DatabasePage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const profile = await getCurrentProfile();
  if (!profile?.roles.includes("admin")) redirect("/attractors");

  const migrations = await checkSchema().catch(() => []);

  // Pulled from the project URL, so the editor link goes to the right project
  // without anybody configuring a second setting.
  const projectRef =
    /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")?.[1] ?? null;

  return (
    <div className="mx-auto max-w-md px-4 py-6">
      <h1 className="mb-1 text-2xl font-bold">Database setup</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Migrations are applied by hand in Supabase. This shows which ones are still outstanding and
        hands you the SQL.
      </p>

      {migrations.length === 0 ? (
        <p className="rounded-lg border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
          Couldn&apos;t check the schema. Make sure Supabase is reachable and reload.
        </p>
      ) : (
        <MigrationRunner migrations={migrations} projectRef={projectRef} />
      )}
    </div>
  );
}

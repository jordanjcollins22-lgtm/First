import { redirect } from "next/navigation";

import { env, isSupabaseConfigured } from "@/lib/env";
import { checkTabAccess } from "@/lib/data/access";
import { DEFAULT_GIS_URL, listGisImportJobs } from "@/lib/data/gis-import";
import { serverEnvDiagnostic } from "@/lib/gis-probe";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { GisImportConsole } from "@/components/gis-import/gis-import-console";

/**
 * Talking to Harford County's GIS server, and what came of it.
 *
 * The county can only be reached from the deployed app, so this page is where
 * every request to it is started and where every answer is read: the
 * connection test that finds the layer's real fields, the bounded ZIP run
 * that proves the import safe, the county-wide run, and the integrity
 * questions asked afterwards. Nothing here waits on the county in the
 * browser; imports run in the background and this page watches them.
 */
// Rendered on every request. What this page says about the server's
// environment must be about the process answering now, never a copy of an
// earlier render.
export const dynamic = "force-dynamic";

export default async function GisImportPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { allowed } = await checkTabAccess("gis-import");
  if (!allowed) redirect("/attractors");

  const jobs = await listGisImportJobs().catch(() => []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <h1 className="mb-1 text-2xl font-bold">County Import</h1>
      <p className="mb-6 text-muted-foreground">
        Harford County&apos;s parcels and addresses, fetched from the county&apos;s own server and
        matched against the houses we already have. Test the connection first; import only when the
        layer&apos;s fields have been found.
      </p>

      <GisImportConsole
        jobs={jobs}
        defaultUrl={env.harfordGisUrl || DEFAULT_GIS_URL}
        environment={serverEnvDiagnostic("page-render")}
      />
    </div>
  );
}

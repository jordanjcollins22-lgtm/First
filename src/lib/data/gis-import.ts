import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type GisImportJob = Database["public"]["Tables"]["gis_import_jobs"]["Row"];

/** The county's public ArcGIS catalog. Discovery finds the address layer under it. */
export const DEFAULT_GIS_URL = "https://hcggis.harfordcountymd.gov/public/rest/services";

/**
 * Recent attempts to talk to the county, newest first.
 *
 * Connection tests and imports sit in one list because they are one story:
 * the test that found the fields is the reason the import that followed knew
 * what to read.
 */
export async function listGisImportJobs(limit = 8): Promise<GisImportJob[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("gis_import_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as GisImportJob[];
}

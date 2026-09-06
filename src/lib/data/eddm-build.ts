import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { clusterCells, type UnservedCell, type UnservedCluster } from "@/lib/eddm-clusters";
import { EDDM_BUILD_KIND, describeBuild } from "@/lib/eddm-build";
import type { EddmBuildStatus } from "@/lib/actions/eddm-build-actions";

/**
 * What the USPS build has produced, read for the Project Data screen.
 *
 * The summary counts the county's routes by verdict and how many became
 * waves; the clusters are the houses no route reaches, grouped into a few
 * missed doors or a likely development.
 */

export interface EddmRouteSummary {
  routes: number;
  walkable: number;
  hard: number;
  unknown: number;
  waves: number;
  housesOnRoutes: number;
  zips: number;
}

export async function eddmRouteSummary(): Promise<EddmRouteSummary> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  const empty: EddmRouteSummary = { routes: 0, walkable: 0, hard: 0, unknown: 0, waves: 0, housesOnRoutes: 0, zips: 0 };
  if (!org) return empty;
  // Route rows are a few hundred for the county: well inside one page.
  const { data, error } = await supabase
    .from("eddm_routes")
    .select("zip, walkability, wave_id, house_count")
    .eq("organization_id", org);
  if (error) throw error;
  const rows = data ?? [];
  return {
    routes: rows.length,
    walkable: rows.filter((r) => r.walkability === "walkable").length,
    hard: rows.filter((r) => r.walkability === "hard").length,
    unknown: rows.filter((r) => r.walkability === "unknown").length,
    waves: rows.filter((r) => r.wave_id).length,
    housesOnRoutes: rows.reduce((sum, r) => sum + (r.house_count ?? 0), 0),
    zips: new Set(rows.map((r) => r.zip)).size,
  };
}

export async function latestEddmBuild(): Promise<EddmBuildStatus | null> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  if (!org) return null;
  const { data: job, error } = await supabase
    .from("gis_import_jobs")
    .select("*")
    .eq("organization_id", org)
    .eq("kind", EDDM_BUILD_KIND)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!job) return null;
  const scope = (job.scope ?? {}) as { zips?: string[] };
  const checkpoint = (job.checkpoint ?? {}) as { offset?: number };
  return {
    jobId: job.id,
    status: job.status,
    summary: describeBuild(job),
    zips: scope.zips?.length ?? 0,
    zipsDone: Math.min(checkpoint.offset ?? 0, scope.zips?.length ?? 0),
    updatedAt: job.updated_at,
  };
}

/** The houses no route reaches, grouped, biggest group first. */
export async function listUnservedClusters(): Promise<UnservedCluster[]> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  if (!org) return [];
  const { data, error } = await supabase.rpc("summary_get", { org, the_key: "eddm_unserved_cells" });
  if (error) throw error;
  return clusterCells((Array.isArray(data) ? data : []) as unknown as UnservedCell[]);
}

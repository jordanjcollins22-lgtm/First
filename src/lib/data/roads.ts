import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { describeRoadsImport, OSM_KIND } from "@/lib/osm-roads";
import type { RoadsStatus } from "@/lib/actions/roads-actions";

export interface RoadsState {
  job: RoadsStatus | null;
  /** How many road segments the county has on file, and how many zones still walk the old lines. */
  segments: number;
  zonesToRewalk: number;
}

/** The last roads import and where the redraw of the walks stands. */
export async function roadsState(): Promise<RoadsState> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  const [{ data: job }, { count: segments }, { data: pending }] = await Promise.all([
    supabase.from("gis_import_jobs").select("id, status, fetched, last_error, scope, checkpoint, updated_at").eq("organization_id", org).eq("kind", OSM_KIND).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("road_segments").select("id", { count: "exact", head: true }).eq("organization_id", org),
    supabase.rpc("zones_rewalk_pending", { org }),
  ]);
  return {
    job: job ? { jobId: job.id, status: job.status, summary: describeRoadsImport(job), updatedAt: job.updated_at } : null,
    segments: segments ?? 0,
    zonesToRewalk: Number(pending ?? 0),
  };
}

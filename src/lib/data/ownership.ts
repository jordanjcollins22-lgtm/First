import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { SDAT_KIND, describeSdatImport } from "@/lib/sdat-import";
import type { SdatStatus } from "@/lib/actions/sdat-actions";
import type { MatrixRow } from "@/lib/house-highlight";
import type { HouseKind } from "@/lib/house-geojson";

/** What the State's roll has told us about the county's houses, in counts. */
export interface OwnershipSummary {
  houses: number;
  known: number;
  ownerOccupied: number;
  absentee: number;
  soldLastYear: number;
  soldLast90: number;
  fetchedAt: string | null;
}

export const EMPTY_OWNERSHIP: OwnershipSummary = { houses: 0, known: 0, ownerOccupied: 0, absentee: 0, soldLastYear: 0, soldLast90: 0, fetchedAt: null };

export async function ownershipSummary(): Promise<OwnershipSummary> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  if (!org) return EMPTY_OWNERSHIP;
  const { data, error } = await supabase.rpc("summary_get", { org, the_key: "ownership_summary" });
  if (error) throw error;
  const raw = (data ?? {}) as Partial<OwnershipSummary>;
  return {
    houses: Number(raw.houses ?? 0),
    known: Number(raw.known ?? 0),
    ownerOccupied: Number(raw.ownerOccupied ?? 0),
    absentee: Number(raw.absentee ?? 0),
    soldLastYear: Number(raw.soldLastYear ?? 0),
    soldLast90: Number(raw.soldLast90 ?? 0),
    fetchedAt: raw.fetchedAt ?? null,
  };
}

export async function latestSdatImport(): Promise<SdatStatus | null> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  if (!org) return null;
  const { data: job, error } = await supabase
    .from("gis_import_jobs")
    .select("id, status, fetched, matched, skipped, total_expected, last_error, updated_at")
    .eq("organization_id", org)
    .eq("kind", SDAT_KIND)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!job) return null;
  return { jobId: job.id, status: job.status, summary: describeSdatImport(job), fetched: job.fetched, totalExpected: job.total_expected, updatedAt: job.updated_at };
}

/** Where we stand against who owns it, counted, for the cross-check table. */
export async function relationshipOwnershipMatrix(): Promise<MatrixRow[]> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  if (!org) return [];
  const { data, error } = await supabase.rpc("summary_get", { org, the_key: "relationship_ownership_matrix" });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as MatrixRow[];
}

/** How many of each kind of door the county has. */
export async function kindSummary(): Promise<Partial<Record<HouseKind, number>>> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  if (!org) return {};
  const { data, error } = await supabase.rpc("summary_get", { org, the_key: "kind_summary" });
  if (error) throw error;
  const out: Partial<Record<HouseKind, number>> = {};
  for (const [k, v] of Object.entries((data ?? {}) as Record<string, unknown>)) out[k as HouseKind] = Number(v) || 0;
  return out;
}

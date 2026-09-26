import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { rankCourts, type CourtStats, type RankedCourt } from "@/lib/court-score";
import type { LatLng } from "@/types/domain";

/**
 * The courts, scored, and the outlines the office has drawn.
 *
 * The scoring lives in code rather than the database so the ranking can
 * change without a migration and be tested without a database. The
 * database keeps the facts; this puts them in order.
 */

export type OperationsTargetStatus = "planned" | "active" | "done";

export interface OperationsTarget {
  id: string;
  name: string;
  outline: LatLng[];
  courtId: string | null;
  status: OperationsTargetStatus;
  notes: string | null;
  houseCount: number | null;
  createdAt: string;
}

interface CourtRow {
  id: string;
  street: string;
  zip: string;
  locality: string | null;
  house_count: number;
  lat: number;
  lng: number;
  spread_m: number | null;
  assessed_median: number | null;
  owner_occupied: number;
  ownership_known: number;
  detached: number;
  townhouse: number;
  condo: number;
  clients: number;
  touched: number;
  jobs_done: number;
  shop_km: number | null;
  built_at: string;
}

export const COURT_COLUMNS =
  "id, street, zip, locality, house_count, lat, lng, spread_m, assessed_median, owner_occupied, ownership_known, detached, townhouse, condo, clients, touched, jobs_done, shop_km, built_at";

export function courtFromRow(r: CourtRow): CourtStats {
  return {
    id: r.id,
    street: r.street,
    zip: r.zip,
    locality: r.locality,
    houseCount: r.house_count,
    lat: r.lat,
    lng: r.lng,
    spreadM: r.spread_m,
    assessedMedian: r.assessed_median,
    ownerOccupied: r.owner_occupied,
    ownershipKnown: r.ownership_known,
    detached: r.detached,
    townhouse: r.townhouse,
    condo: r.condo,
    clients: r.clients,
    touched: r.touched,
    jobsDone: r.jobs_done,
    shopKm: r.shop_km,
  };
}

export interface CourtRanking {
  courts: RankedCourt[];
  total: number;
  builtAt: string | null;
}

/** Every court in order, best first, without its outline. */
export async function listRankedCourts(top = 40): Promise<CourtRanking> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  if (!org) return { courts: [], total: 0, builtAt: null };
  const { data, error } = await supabase.from("court_targets").select(COURT_COLUMNS).eq("organization_id", org).limit(5000);
  if (error) throw error;
  const rows = (data ?? []) as unknown as CourtRow[];
  const ranked = rankCourts(rows.map(courtFromRow));
  return { courts: ranked.slice(0, top), total: ranked.length, builtAt: rows[0]?.built_at ?? null };
}

export async function listOperationsTargets(): Promise<OperationsTarget[]> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  if (!org) return [];
  const { data, error } = await supabase
    .from("operations_targets")
    .select("id, name, outline, court_id, status, notes, house_count, created_at")
    .eq("organization_id", org)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    outline: (r.outline ?? []) as unknown as LatLng[],
    courtId: r.court_id,
    status: r.status as OperationsTargetStatus,
    notes: r.notes,
    houseCount: r.house_count,
    createdAt: r.created_at,
  }));
}

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DataScope } from "@/lib/data/review-scope";
import { isMissingTable } from "@/lib/setup-errors";
import { LEAD_FINDER_WEEKLY_COUNT } from "@/lib/lead-finder";
import { rowFromDb, seedRows, type FinderRow } from "@/lib/lead-finder-view";
import { SEED_PROSPECTS } from "@/lib/lead-finder-seed";

/**
 * The lead finder's data: this week's list, and the counts behind it.
 *
 * Works before migration 0375: with no table it says so (`ready` false) and
 * hands back the seed business list as this week's, so the page and the
 * review page still show the loop.
 */

// The table is newer than the generated types.
const untyped = (c: unknown) => c as SupabaseClient;

export interface FinderData {
  ready: boolean;
  week: string;
  /** This week's list, best first. */
  rows: FinderRow[];
  counts: { total: number; waiting: number; reviewed: number; leads: number; skipped: number };
}

const COLUMNS =
  "id, source, name, category, address, city, zip, lat, lng, land_use, acreage, assessed_value, owner_name, owner_mailing, owner_state, phone, website, seed_priority, priority, status, week_of, checks, score, services, note";

export async function loadLeadFinder(scope: DataScope, week: string): Promise<FinderData> {
  const sb = untyped(scope.client);
  const { data, error } = await sb
    .from("lead_finder_parcels")
    .select(COLUMNS)
    .eq("organization_id", scope.organizationId)
    .eq("week_of", week)
    .order("priority", { ascending: false })
    .limit(200);
  if (error) {
    if (isMissingTable(error) || /does not exist/i.test(error.message)) return fallback(week);
    throw error;
  }

  const count = async (status?: string) => {
    let q = sb.from("lead_finder_parcels").select("id", { count: "exact", head: true }).eq("organization_id", scope.organizationId);
    if (status) q = q.eq("status", status);
    const { count: n } = await q;
    return n ?? 0;
  };
  const [total, waiting, reviewed, leads, skipped] = await Promise.all([count(), count("new"), count("reviewed"), count("lead"), count("skipped")]);

  return {
    ready: true,
    week,
    rows: ((data ?? []) as Record<string, unknown>[]).map(rowFromDb),
    counts: { total, waiting, reviewed, leads, skipped },
  };
}

/** The seed list, for when the table is not there. */
export function fallback(week: string): FinderData {
  const rows = seedRows(week, LEAD_FINDER_WEEKLY_COUNT);
  return { ready: false, week, rows, counts: { total: SEED_PROSPECTS.length, waiting: SEED_PROSPECTS.length, reviewed: 0, leads: 0, skipped: 0 } };
}

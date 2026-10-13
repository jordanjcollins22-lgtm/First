import type { SupabaseClient } from "@supabase/supabase-js";

import { readAreas, readZips, type Territory } from "@/lib/sales/territories";

/**
 * Evaluator territories, from the database. Read with whatever client the
 * caller has: the office's own (under its row security) for the panel, the
 * service role for a booking from /book or GoHighLevel where nobody is
 * signed in. A missing table (migration 0361 not applied) reads as no
 * territories, so routing carries on exactly as before.
 */

export interface TerritoryRow extends Territory {
  id: string | null;
  name: string | null;
  updatedAt: string | null;
}

const untyped = (c: unknown) => c as SupabaseClient;

export async function loadTerritories(client: unknown, organizationId: string): Promise<{ territories: TerritoryRow[]; ready: boolean }> {
  const { data, error } = await untyped(client)
    .from("evaluator_territories")
    .select("id, evaluator_id, name, zips, areas, active, updated_at")
    .eq("organization_id", organizationId);
  if (error) return { territories: [], ready: false };
  return {
    ready: true,
    territories: ((data ?? []) as { id: string; evaluator_id: string; name: string | null; zips: string[] | null; areas: unknown; active: boolean; updated_at: string }[]).map((r) => ({
      id: r.id,
      evaluatorId: r.evaluator_id,
      name: r.name,
      zips: readZips(r.zips ?? []),
      areas: readAreas(r.areas),
      active: r.active,
      updatedAt: r.updated_at,
    })),
  };
}

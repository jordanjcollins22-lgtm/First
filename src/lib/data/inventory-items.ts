import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import type { InventoryItem } from "@/lib/forward-materials";
import type { Database } from "@/lib/supabase/database.types";

/**
 * The job materials in the inventory, with their photo and link, for
 * matching to the services a forward price uses. Empty when they can't be
 * read, so a price still shows; the materials just say they aren't matched.
 */
export async function getInventoryItems(supabase: SupabaseClient<Database>, organizationId: string): Promise<InventoryItem[]> {
  const { data, error } = await supabase
    .from("materials")
    .select("id, name, unit, image_path, purchase_url, coverage_per_unit_sqft, waste_factor_pct")
    .eq("organization_id", organizationId)
    .eq("active", true)
    .eq("category", "job")
    .order("name");
  if (error) {
    console.error("[inventory-items] read failed:", error.message);
    return [];
  }
  return (data ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    unit: m.unit ?? null,
    imageUrl: m.image_path ? `${env.supabaseUrl}/storage/v1/object/public/material-images/${m.image_path}` : null,
    url: m.purchase_url?.trim() || null,
    coverageSqFt: m.coverage_per_unit_sqft != null && Number(m.coverage_per_unit_sqft) > 0 ? Number(m.coverage_per_unit_sqft) : null,
    wastePct: Number(m.waste_factor_pct ?? 0) || 0,
  }));
}

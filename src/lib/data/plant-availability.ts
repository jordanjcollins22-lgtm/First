import type { SupabaseClient } from "@supabase/supabase-js";

import type { PlantRow } from "@/lib/plant-pricing";

type Row = {
  id: string;
  item_code: string;
  name: string;
  size: string;
  native: string | null;
  hardy: string | null;
  category: string | null;
  program: string | null;
  cost_cents: number;
  sale_cents: number | null;
  sale_until: string | null;
  condition: string | null;
  available: number;
  week_of: string;
  supplier: { name: string } | null;
};

/**
 * Every plant the nurseries have offered, this week's numbers on each, by
 * name. Empty when nothing has been loaded, and also when the table isn't
 * there yet (migration 0354), so the page can say so instead of failing.
 */
export async function getPlantAvailability(supabase: SupabaseClient, organizationId: string): Promise<{ plants: PlantRow[]; ready: boolean }> {
  // plant_availability is newer than the generated types, so it is read untyped.
  const { data, error } = await supabase
    .from("plant_availability")
    .select("id, item_code, name, size, native, hardy, category, program, cost_cents, sale_cents, sale_until, condition, available, week_of, supplier:material_suppliers(name)")
    .eq("organization_id", organizationId)
    .order("name")
    .order("size");
  if (error) {
    const missing = error.code === "42P01" || error.code === "PGRST205";
    if (!missing) console.error("[plant-availability] read failed:", error.message);
    return { plants: [], ready: !missing };
  }
  return {
    ready: true,
    plants: ((data ?? []) as unknown as Row[]).map((r) => ({
      id: r.id,
      itemCode: r.item_code,
      name: r.name,
      size: r.size,
      native: r.native,
      hardy: r.hardy,
      category: r.category,
      program: r.program,
      costCents: r.cost_cents,
      saleCents: r.sale_cents,
      saleUntil: r.sale_until,
      condition: r.condition,
      available: r.available,
      weekOf: r.week_of,
      supplier: r.supplier?.name ?? "",
    })),
  };
}

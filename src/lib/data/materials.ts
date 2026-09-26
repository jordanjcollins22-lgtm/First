import { createClient } from "@/lib/supabase/server";
import type { Material } from "@/types/domain";
import type { MaterialOption } from "@/lib/inventory-groups";

export type { InventoryGroup, MaterialOption } from "@/lib/inventory-groups";
export { INVENTORY_GROUPS } from "@/lib/inventory-groups";

export type MaterialCategory = "job" | "marketing";

/**
 * Materials for the job — the ones an estimator picks from.
 *
 * Defaulted rather than optional on purpose: every existing caller is pricing
 * work, and a patio quote offering "door hangers" as a material would be a
 * new bug introduced by a new feature.
 */
export async function listMaterials(category: MaterialCategory = "job"): Promise<Material[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("materials")
    .select("*")
    .eq("active", true)
    .eq("category", category)
    .order("name");

  if (error) throw error;
  return (data ?? []) as unknown as Material[];
}

/** Door hangers, flyers, yard signs, business cards. Same table, same stock
 * levels and reorder alerts, different list. */
export async function listMarketingMaterials(): Promise<Material[]> {
  return listMaterials("marketing");
}

/**
 * Everything in inventory, all four lists.
 *
 * Materials only was a quiet lie: the printer an idea runs through is a tool,
 * so are the mower and the blower, and offering half the inventory made the
 * other half look like it did not exist.
 *
 * Tools have no unit — one mower is one mower — and their price is what it
 * costs to have one, falling back to the cost of owning where something is
 * rented and has no purchase price of its own.
 */
export async function listMaterialOptions(): Promise<MaterialOption[]> {
  const supabase = await createClient();

  const [materialsRes, toolsRes] = await Promise.all([
    supabase.from("materials").select("id, name, unit, cost_per_unit, category, kind").eq("active", true),
    supabase.from("tools").select("id, name, cost, cost_to_own, category").eq("active", true),
  ]);

  if (materialsRes.error) throw materialsRes.error;

  const materials: MaterialOption[] = ((materialsRes.data ?? []) as unknown as {
    id: string;
    name: string;
    unit: string;
    cost_per_unit: number | null;
    category: string;
    kind: string | null;
  }[]).map((m) => ({
    id: m.id,
    name: m.name,
    unit: m.unit,
    costPerUnit: m.cost_per_unit != null ? Number(m.cost_per_unit) : null,
    group: m.category === "marketing" ? "marketing" : "materials",
    kind: "material",
    isFee: m.kind === "other",
  }));

  // A tools table that is not there yet costs the tools, not the whole list.
  const tools: MaterialOption[] = ((toolsRes.data ?? []) as unknown as {
    id: string;
    name: string;
    cost: number | null;
    cost_to_own: number | null;
    category: string | null;
  }[]).map((t) => ({
    id: t.id,
    name: t.name,
    unit: "each",
    costPerUnit: t.cost != null ? Number(t.cost) : t.cost_to_own != null ? Number(t.cost_to_own) : null,
    group: t.category === "gear" ? "gear" : "tools",
    kind: "tool",
  }));

  return [...materials, ...tools].sort((a, b) => a.name.localeCompare(b.name));
}

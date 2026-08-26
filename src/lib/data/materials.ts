import { createClient } from "@/lib/supabase/server";
import type { Material } from "@/types/domain";

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

export interface MaterialOption {
  id: string;
  name: string;
  unit: string;
  costPerUnit: number | null;
  category: MaterialCategory;
}

/**
 * Everything in inventory, both lists, for picking one to link a node to.
 *
 * Both categories on purpose: an idea might need cardstock (marketing) or
 * mulch (job), and refusing to link across the two would make somebody keep
 * a second copy of the mulch, which is the thing linking exists to stop.
 */
export async function listMaterialOptions(): Promise<MaterialOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("materials")
    .select("id, name, unit, cost_per_unit, category")
    .eq("active", true)
    .order("name");

  if (error) throw error;

  return ((data ?? []) as unknown as {
    id: string;
    name: string;
    unit: string;
    cost_per_unit: number | null;
    category: string;
  }[]).map((m) => ({
    id: m.id,
    name: m.name,
    unit: m.unit,
    costPerUnit: m.cost_per_unit != null ? Number(m.cost_per_unit) : null,
    category: m.category === "marketing" ? "marketing" : "job",
  }));
}

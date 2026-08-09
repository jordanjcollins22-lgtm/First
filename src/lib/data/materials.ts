import { createClient } from "@/lib/supabase/server";
import type { Material } from "@/types/domain";

export async function listMaterials(): Promise<Material[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("materials")
    .select("*")
    .eq("active", true)
    .order("name");

  if (error) throw error;
  return (data ?? []) as unknown as Material[];
}

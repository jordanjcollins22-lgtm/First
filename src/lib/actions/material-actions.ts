"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export async function createMaterial(formData: FormData) {
  const supabase = await createClient();

  const name = String(formData.get("name") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  if (!name) throw new Error("Material name is required");
  if (!unit) throw new Error("Unit is required");

  const coverageRaw = String(formData.get("coverage_per_unit_sqft") ?? "").trim();
  const costRaw = String(formData.get("cost_per_unit") ?? "").trim();
  const wasteRaw = String(formData.get("waste_factor_pct") ?? "").trim();

  const { error } = await supabase.from("materials").insert({
    name,
    unit,
    coverage_per_unit_sqft: coverageRaw ? Number(coverageRaw) : null,
    cost_per_unit: costRaw ? Number(costRaw) : null,
    waste_factor_pct: wasteRaw ? Number(wasteRaw) : 10,
  });
  if (error) throw error;

  revalidatePath("/admin/materials");
  revalidatePath("/canvas");
}

export async function updateMaterialCost(id: string, costPerUnit: number | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("materials").update({ cost_per_unit: costPerUnit }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/materials");
  revalidatePath("/canvas");
}

export async function deactivateMaterial(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("materials").update({ active: false }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/materials");
  revalidatePath("/canvas");
}

export async function addServiceMaterialRule(formData: FormData) {
  const supabase = await createClient();

  const materialId = String(formData.get("material_id") ?? "");
  const serviceTypeId = String(formData.get("service_type_id") ?? "").trim();
  if (!materialId || !serviceTypeId) throw new Error("Material and service are required");

  const matchField = String(formData.get("match_field") ?? "").trim() || null;
  const matchValue = String(formData.get("match_value") ?? "").trim() || null;

  const { error } = await supabase.from("service_materials").insert({
    material_id: materialId,
    service_type_id: serviceTypeId,
    match_field: matchField,
    match_value: matchValue,
  });
  if (error) throw error;

  revalidatePath("/admin/materials");
  revalidatePath("/canvas");
}

export async function deleteServiceMaterialRule(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("service_materials").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/materials");
  revalidatePath("/canvas");
}

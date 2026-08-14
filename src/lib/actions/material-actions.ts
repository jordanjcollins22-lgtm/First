"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";

export async function createMaterial(formData: FormData) {
  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();

  const name = String(formData.get("name") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  if (!name) throw new Error("Material name is required");
  if (!unit) throw new Error("Unit is required");

  const coverageRaw = String(formData.get("coverage_per_unit_sqft") ?? "").trim();
  const costRaw = String(formData.get("cost_per_unit") ?? "").trim();
  const wasteRaw = String(formData.get("waste_factor_pct") ?? "").trim();
  const purchaseUrl = String(formData.get("purchase_url") ?? "").trim() || null;
  const quantityRaw = String(formData.get("quantity_on_hand") ?? "").trim();
  const reorderRaw = String(formData.get("reorder_threshold") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const storageLocation = String(formData.get("storage_location") ?? "").trim() || null;
  const shopLocation = String(formData.get("shop_location") ?? "").trim() || null;
  const imagePath = String(formData.get("image_path") ?? "").trim() || null;
  const quantityOnHand = quantityRaw ? Number(quantityRaw) : null;
  const stockMethod = String(formData.get("stock_method") ?? "in_stock").trim() === "order_as_needed"
    ? "order_as_needed"
    : "in_stock";
  const isDelivered = formData.get("is_delivered") === "on" || formData.get("is_delivered") === "true";

  if (stockMethod === "in_stock" && !storageLocation) {
    throw new Error("Enter where it's stored — required for materials kept in stock.");
  }
  if (!imagePath) {
    throw new Error("Add a photo of the material.");
  }

  const { data, error } = await supabase
    .from("materials")
    .insert({
      organization_id: organizationId,
      name,
      unit,
      coverage_per_unit_sqft: coverageRaw ? Number(coverageRaw) : null,
      cost_per_unit: costRaw ? Number(costRaw) : null,
      waste_factor_pct: wasteRaw ? Number(wasteRaw) : 10,
      purchase_url: purchaseUrl,
      quantity_on_hand: quantityOnHand,
      reorder_threshold: reorderRaw ? Number(reorderRaw) : null,
      description,
      storage_location: storageLocation,
      shop_location: shopLocation,
      stock_method: stockMethod,
      is_delivered: isDelivered,
      image_path: imagePath,
    })
    .select()
    .single();
  if (error) throw error;

  revalidatePath("/admin/materials");
  revalidatePath("/canvas");
  return { id: data.id as string, name: data.name as string };
}

export async function updateMaterialCost(id: string, costPerUnit: number | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("materials").update({ cost_per_unit: costPerUnit }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/materials");
  revalidatePath("/canvas");
}

export async function updateMaterialDescription(id: string, description: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("materials").update({ description }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/materials");
  revalidatePath("/canvas");
}

export async function updateMaterialStorageLocation(id: string, storageLocation: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("materials").update({ storage_location: storageLocation }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/materials");
  revalidatePath("/canvas");
}

export async function updateMaterialStockMethod(id: string, stockMethod: "in_stock" | "order_as_needed") {
  const supabase = await createClient();
  const { error } = await supabase.from("materials").update({ stock_method: stockMethod }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/materials");
  revalidatePath("/canvas");
}

export async function updateMaterialDelivered(id: string, isDelivered: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("materials").update({ is_delivered: isDelivered }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/materials");
  revalidatePath("/canvas");
}

export async function updateMaterialShopLocation(id: string, shopLocation: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("materials").update({ shop_location: shopLocation }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/materials");
  revalidatePath("/canvas");
}

export async function updateMaterialCanStore(id: string, canStore: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("materials").update({ can_store: canStore }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/materials");
}

export async function updateMaterialStorageAlternative(id: string, storageAlternative: string | null) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("materials")
    .update({ storage_alternative: storageAlternative })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/materials");
}

export async function updateMaterialStorageRequirements(id: string, storageRequirements: string | null) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("materials")
    .update({ storage_requirements: storageRequirements })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/materials");
}

export async function updateMaterialStorageCost(id: string, storageCost: number | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("materials").update({ storage_cost: storageCost }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/materials");
}

export async function updateMaterialImage(id: string, imagePath: string | null) {
  const supabase = await createClient();

  const { data: existing } = await supabase.from("materials").select("image_path").eq("id", id).maybeSingle();
  if (existing?.image_path && existing.image_path !== imagePath) {
    await supabase.storage.from("material-images").remove([existing.image_path]);
  }

  const { error } = await supabase.from("materials").update({ image_path: imagePath }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/materials");
  revalidatePath("/canvas");
}

export async function updateMaterialPurchaseUrl(id: string, purchaseUrl: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("materials").update({ purchase_url: purchaseUrl }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/materials");
  revalidatePath("/canvas");
}

export async function updateMaterialQuantityOnHand(id: string, quantity: number | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("materials").update({ quantity_on_hand: quantity }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/materials");
  revalidatePath("/canvas");
}

export async function updateMaterialReorderThreshold(id: string, threshold: number | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("materials").update({ reorder_threshold: threshold }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/materials");
  revalidatePath("/canvas");
}

export async function setMaterialOnOrder(id: string, onOrder: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("materials").update({ on_order: onOrder }).eq("id", id);
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

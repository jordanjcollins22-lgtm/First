"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { derivedCostPerUnit } from "@/lib/pricing";

export async function createMaterial(formData: FormData) {
  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();

  const name = String(formData.get("name") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  if (!name) throw new Error("Material name is required");
  if (!unit) throw new Error("Unit is required");

  const coverageRaw = String(formData.get("coverage_per_unit_sqft") ?? "").trim();
  const costRaw = String(formData.get("cost_per_unit") ?? "").trim();
  const packSizeRaw = String(formData.get("pack_size") ?? "").trim();
  const packCostRaw = String(formData.get("pack_cost") ?? "").trim();
  const packSize = packSizeRaw ? Number(packSizeRaw) : null;
  const packCost = packCostRaw ? Number(packCostRaw) : null;
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
  // Anything unrecognised is job stock: that is the list the estimator uses,
  // and the wrong item showing up there is visible where a missing one is not.
  const category = String(formData.get("category") ?? "job") === "marketing" ? "marketing" : "job";
  // Anything unrecognised is stock. "Other" is the unusual answer, and the
  // wrong one showing up as a material is visible where the reverse is not.
  const kind = String(formData.get("kind") ?? "material") === "other" ? "other" : "material";

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
      category,
      kind,
      coverage_per_unit_sqft: coverageRaw ? Number(coverageRaw) : null,
      cost_per_unit: derivedCostPerUnit(packSize, packCost, costRaw ? Number(costRaw) : null),
      pack_size: packSize,
      pack_cost: packCost,
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
  revalidatePath("/admin/tools");
  revalidatePath("/knowledge-graph");
  revalidatePath("/canvas");
  return { id: data.id as string, name: data.name as string };
}

/** Saves what a pack costs and recomputes the per-unit price from it. */
export async function updateMaterialPack(id: string, packSize: number | null, packCost: number | null) {
  const supabase = await createClient();
  const { data: existing } = await supabase.from("materials").select("cost_per_unit").eq("id", id).maybeSingle();
  const { error } = await supabase
    .from("materials")
    .update({
      pack_size: packSize,
      pack_cost: packCost,
      cost_per_unit: derivedCostPerUnit(packSize, packCost, existing?.cost_per_unit ?? null),
    })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/tools");
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

/** The types/colors this material comes in — drives whether the evaluator gets asked at all. */
export async function updateMaterialOptions(id: string, key: "type_options" | "color_options", options: string[]) {
  const supabase = await createClient();
  const cleaned = Array.from(new Set(options.map((o) => o.trim()).filter(Boolean)));
  const { error } = await supabase
    .from("materials")
    .update(key === "type_options" ? { type_options: cleaned } : { color_options: cleaned })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/tools");
  revalidatePath("/canvas");
}

/** Links a material to a service, picked directly from the service's own COGS calculator. */
export async function linkMaterialToService(serviceTypeId: string, materialId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("service_materials").insert({
    material_id: materialId,
    service_type_id: serviceTypeId,
  });
  if (error) throw error;

  revalidatePath("/admin/team");
  revalidatePath("/canvas");
}

export async function deleteServiceMaterialRule(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("service_materials").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/team");
  revalidatePath("/canvas");
}

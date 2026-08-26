"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { derivedCostPerUnit } from "@/lib/pricing";
import { describeDbError } from "@/lib/setup-errors";

export type CreateMaterialResult =
  | { ok: true; id: string; name: string }
  | { ok: false; message: string };

/**
 * Adds a material, and says what went wrong when it does not.
 *
 * Returns rather than throws. A thrown message does not survive a production
 * build — Next strips it and React hands the browser "Minified React error
 * #441", which tells somebody adding a flyer precisely nothing. Every reason
 * this can fail is a reason a person can act on: a name already taken, a
 * missing photo, no storage location. They should read it.
 */
export async function createMaterial(formData: FormData): Promise<CreateMaterialResult> {
  try {
    return await createMaterialInner(formData);
  } catch (err) {
    console.error("createMaterial failed:", err);
    const message = err instanceof Error ? err.message : String(err ?? "");
    return { ok: false, message: message || "Couldn't add that — try again." };
  }
}

async function createMaterialInner(formData: FormData): Promise<CreateMaterialResult> {
  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();

  const name = String(formData.get("name") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  if (!name) return { ok: false, message: "Give it a name." };
  if (!unit) return { ok: false, message: "Say what one of it is — a bag, a sheet, a yard." };

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
    return { ok: false, message: "Enter where it's stored — required for anything kept in stock." };
  }
  if (!imagePath) {
    return { ok: false, message: "Add a photo of it." };
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

  if (error) {
    // Names are unique per organisation, and the row holding a name is not
    // always one anybody can see: removing something sets active = false
    // rather than deleting it, and every list filters those out. Refusing to
    // add a thing that is not on any screen is a dead end with no way out of
    // it, so a removed one is brought back instead.
    if (error.code === "23505") {
      return await reviveMaterial(name, {
        organizationId,
        unit,
        category,
        kind,
        coverage: coverageRaw ? Number(coverageRaw) : null,
        costPerUnit: derivedCostPerUnit(packSize, packCost, costRaw ? Number(costRaw) : null),
        packSize,
        packCost,
        waste: wasteRaw ? Number(wasteRaw) : 10,
        purchaseUrl,
        quantityOnHand,
        reorder: reorderRaw ? Number(reorderRaw) : null,
        description,
        storageLocation,
        shopLocation,
        stockMethod,
        isDelivered,
        imagePath,
      });
    }
    return { ok: false, message: describeDbError(error) };
  }

  revalidatePath("/admin/materials");
  revalidatePath("/admin/tools");
  revalidatePath("/knowledge-graph");
  revalidatePath("/canvas");
  return { ok: true, id: data.id as string, name: data.name as string };
}

/**
 * Brings back the row that was already holding this name.
 *
 * Only ever an active one is refused. A removed one is reactivated and
 * overwritten with what was just typed, which is what "add it again" means
 * to the person doing it — the alternative is telling them to go and edit
 * something that appears on no list in the app.
 */
async function reviveMaterial(
  name: string,
  values: {
    organizationId: string;
    unit: string;
    category: string;
    kind: string;
    coverage: number | null;
    costPerUnit: number | null;
    packSize: number | null;
    packCost: number | null;
    waste: number;
    purchaseUrl: string | null;
    quantityOnHand: number | null;
    reorder: number | null;
    description: string | null;
    storageLocation: string | null;
    shopLocation: string | null;
    stockMethod: string;
    isDelivered: boolean;
    imagePath: string;
  }
): Promise<CreateMaterialResult> {
  const supabase = await createClient();

  const { data: existing, error: findError } = await supabase
    .from("materials")
    .select("id, active, category")
    .eq("organization_id", values.organizationId)
    .eq("name", name)
    .maybeSingle();

  if (findError) return { ok: false, message: describeDbError(findError) };
  if (!existing) return { ok: false, message: `"${name}" is already taken.` };

  if (existing.active) {
    const where = existing.category === "marketing" ? "Marketing" : "Materials";
    return { ok: false, message: `"${name}" is already on the ${where} list — edit that one instead.` };
  }

  const { data, error } = await supabase
    .from("materials")
    .update({
      active: true,
      unit: values.unit,
      category: values.category,
      kind: values.kind,
      coverage_per_unit_sqft: values.coverage,
      cost_per_unit: values.costPerUnit,
      pack_size: values.packSize,
      pack_cost: values.packCost,
      waste_factor_pct: values.waste,
      purchase_url: values.purchaseUrl,
      quantity_on_hand: values.quantityOnHand,
      reorder_threshold: values.reorder,
      description: values.description,
      storage_location: values.storageLocation,
      shop_location: values.shopLocation,
      stock_method: values.stockMethod,
      is_delivered: values.isDelivered,
      image_path: values.imagePath,
    } as never)
    .eq("id", existing.id)
    .select()
    .single();

  if (error) return { ok: false, message: describeDbError(error) };

  revalidatePath("/admin/materials");
  revalidatePath("/admin/tools");
  revalidatePath("/knowledge-graph");
  revalidatePath("/canvas");
  return { ok: true, id: data.id as string, name: data.name as string };
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

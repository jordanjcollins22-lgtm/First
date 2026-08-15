"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import type { ToolCategory } from "@/types/domain";

export type CreateToolResult =
  | { ok: true; id: string; name: string }
  | { ok: false; message: string };

/**
 * Returns a result object rather than throwing. An Error thrown out of a
 * Server Action gets its message stripped in production builds and reaches
 * the browser as an opaque "Server Components render" error, which makes a
 * plain "you're missing a field" impossible to tell from a real bug. A
 * returned value is ordinary data, so the real reason always survives.
 */
export async function createTool(formData: FormData): Promise<CreateToolResult> {
  try {
    return await createToolInner(formData);
  } catch (err) {
    console.error("createTool failed:", err);
    const message = err instanceof Error ? err.message : String(err ?? "");
    return { ok: false, message: message || "Couldn't add that tool — try again." };
  }
}

async function createToolInner(formData: FormData): Promise<CreateToolResult> {
  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Enter a tool name." };

  const icon = String(formData.get("icon") ?? "").trim() || "🧰";
  const costRaw = String(formData.get("cost") ?? "").trim();
  const cost = costRaw ? Number(costRaw) : null;
  const isRental = formData.get("is_rental") === "on";
  const kitsRaw = String(formData.get("kits") ?? "").trim();
  const kits = kitsRaw
    ? [
        ...new Set(
          kitsRaw
            .split(",")
            .map((k) => Number(k.trim()))
            .filter((n) => Number.isInteger(n) && n > 0)
        ),
      ]
    : [];
  const quantityRaw = String(formData.get("quantity") ?? "").trim();
  const quantity = quantityRaw ? Number(quantityRaw) : null;
  const imagePath = String(formData.get("image_path") ?? "").trim() || null;
  const storageLocation = String(formData.get("storage_location") ?? "").trim() || null;
  const shopLocation = String(formData.get("shop_location") ?? "").trim() || null;
  const purchaseUrl = String(formData.get("purchase_url") ?? "").trim() || null;
  const reorderRaw = String(formData.get("reorder_threshold") ?? "").trim();
  const reorderThreshold = reorderRaw ? Number(reorderRaw) : null;
  const stockMethod = String(formData.get("stock_method") ?? "in_stock").trim() === "order_as_needed"
    ? "order_as_needed"
    : "in_stock";
  const isDelivered = formData.get("is_delivered") === "on" || formData.get("is_delivered") === "true";
  const category = String(formData.get("category") ?? "tool").trim() === "gear" ? "gear" : "tool";

  if (stockMethod === "in_stock" && !storageLocation) {
    return { ok: false, message: "Enter where it's stored — required for tools kept in stock." };
  }
  if (!imagePath) {
    return { ok: false, message: "Add a photo of the tool." };
  }

  const { data, error } = await supabase
    .from("tools")
    .insert({
      organization_id: organizationId,
      name,
      category,
      icon,
      cost,
      is_rental: isRental,
      kits,
      quantity,
      image_path: imagePath,
      storage_location: storageLocation,
      shop_location: shopLocation,
      purchase_url: purchaseUrl,
      reorder_threshold: reorderThreshold,
      stock_method: stockMethod,
      is_delivered: isDelivered,
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, message: `A tool named "${name}" already exists.` };
    return {
      ok: false,
      message: error.message ? `${error.message}${error.code ? ` (${error.code})` : ""}` : "Couldn't add that tool.",
    };
  }

  revalidatePath("/admin/tools");
  return { ok: true, id: data.id as string, name: data.name as string };
}

/** Moves an item between Tools and Crew Gear. Everything else about it —
 * stock, storage, reorder point, cost — carries over untouched, which is the
 * point of keeping both in one table. */
export async function updateToolCategory(id: string, category: ToolCategory) {
  const supabase = await createClient();
  const { error } = await supabase.from("tools").update({ category }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/tools");
  revalidatePath("/canvas");
}

export async function updateToolCost(id: string, cost: number | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("tools").update({ cost }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/tools");
  revalidatePath("/canvas");
}

export async function updateToolQuantity(id: string, quantity: number | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("tools").update({ quantity }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/tools");
  revalidatePath("/canvas");
}

export async function updateToolOwnership(id: string, isRental: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("tools").update({ is_rental: isRental }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/tools");
  revalidatePath("/canvas");
}

export async function updateToolStorageLocation(id: string, storageLocation: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("tools").update({ storage_location: storageLocation }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/tools");
  revalidatePath("/canvas");
}

export async function updateToolStockMethod(id: string, stockMethod: "in_stock" | "order_as_needed") {
  const supabase = await createClient();
  const { error } = await supabase.from("tools").update({ stock_method: stockMethod }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/tools");
  revalidatePath("/canvas");
}

export async function updateToolDelivered(id: string, isDelivered: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("tools").update({ is_delivered: isDelivered }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/tools");
  revalidatePath("/canvas");
}

export async function updateToolShopLocation(id: string, shopLocation: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("tools").update({ shop_location: shopLocation }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/tools");
  revalidatePath("/canvas");
}

export async function updateToolNotOwnedReason(id: string, reason: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("tools").update({ not_owned_reason: reason }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/tools");
}

export async function updateToolCostToOwn(id: string, costToOwn: number | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("tools").update({ cost_to_own: costToOwn }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/tools");
}

export async function updateToolPurchaseUrl(id: string, purchaseUrl: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("tools").update({ purchase_url: purchaseUrl }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/tools");
  revalidatePath("/canvas");
}

/** YouTube (or any) link showing how to use this tool — surfaces on services and job checklists. */
export async function updateToolHowToUrl(id: string, howToUrl: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("tools").update({ how_to_url: howToUrl }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/tools");
  revalidatePath("/admin/team");
  revalidatePath("/canvas");
}

export async function updateToolReorderThreshold(id: string, threshold: number | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("tools").update({ reorder_threshold: threshold }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/tools");
  revalidatePath("/canvas");
}

export async function setToolOnOrder(id: string, onOrder: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("tools").update({ on_order: onOrder }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/tools");
  revalidatePath("/canvas");
}

export async function updateToolKits(id: string, kits: number[]) {
  const supabase = await createClient();
  const { error } = await supabase.from("tools").update({ kits }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/tools");
  revalidatePath("/canvas");
}

export async function updateToolImage(id: string, imagePath: string | null) {
  const supabase = await createClient();

  const { data: existing } = await supabase.from("tools").select("image_path").eq("id", id).maybeSingle();
  if (existing?.image_path && existing.image_path !== imagePath) {
    await supabase.storage.from("tool-images").remove([existing.image_path]);
  }

  const { error } = await supabase.from("tools").update({ image_path: imagePath }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/tools");
  revalidatePath("/canvas");
}

export async function deactivateTool(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("tools").update({ active: false }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/tools");
  revalidatePath("/canvas");
}

export async function setServiceToolLink(serviceTypeId: string, toolId: string, enabled: boolean) {
  const supabase = await createClient();
  if (enabled) {
    const { error } = await supabase
      .from("service_tools")
      .upsert({ service_type_id: serviceTypeId, tool_id: toolId });
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("service_tools")
      .delete()
      .eq("service_type_id", serviceTypeId)
      .eq("tool_id", toolId);
    if (error) throw error;
  }
  revalidatePath("/admin/tools");
  revalidatePath("/admin/team");
  revalidatePath("/canvas");
}

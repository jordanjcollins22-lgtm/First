"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export async function createTool(formData: FormData) {
  const supabase = await createClient();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Tool name is required");

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

  const { error } = await supabase
    .from("tools")
    .insert({ name, icon, cost, is_rental: isRental, kits, quantity, image_path: imagePath });
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
  revalidatePath("/canvas");
}

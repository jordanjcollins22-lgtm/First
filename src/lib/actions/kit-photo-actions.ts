"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { kitPhotoFolder } from "@/lib/kit-photos";

export type KitPhotoResult = { ok: true } | { ok: false; message: string };

/**
 * Sets, replaces or clears a kit's photo. The image is already uploaded to
 * this business's kits folder; the one it replaces is deleted, so the bucket
 * holds one photo per kit.
 */
export async function setKitPhoto(kit: number, path: string | null): Promise<KitPhotoResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  if (!Number.isInteger(kit) || kit < 1) return { ok: false, message: "That isn't a kit number." };
  const organizationId = await getCurrentOrganizationId();
  if (path && !path.startsWith(kitPhotoFolder(organizationId))) return { ok: false, message: "That photo isn't in this business's kit folder." };

  const supabase = await createClient();
  const { data: existing } = await supabase.from("kit_photos").select("image_path").eq("kit", kit).maybeSingle();

  const { error } = path
    ? await supabase
        .from("kit_photos")
        .upsert({ organization_id: organizationId, kit, image_path: path, updated_by: profile.id, updated_at: new Date().toISOString() })
    : await supabase.from("kit_photos").delete().eq("kit", kit);
  if (error) return { ok: false, message: "Couldn't save the photo. Try again." };

  if (existing?.image_path && existing.image_path !== path) {
    await supabase.storage.from("tool-images").remove([existing.image_path]);
  }
  revalidatePath("/admin/tools/kits");
  revalidatePath("/today");
  revalidatePath("/my-day");
  return { ok: true };
}

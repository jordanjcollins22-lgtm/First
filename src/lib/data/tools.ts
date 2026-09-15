import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { KitTool } from "@/lib/kit-sheet";
import type { Tool } from "@/types/domain";

export async function listTools(): Promise<Tool[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tools")
    .select("*")
    .eq("active", true)
    .order("name");

  if (error) throw error;
  return (data ?? []) as unknown as Tool[];
}

/**
 * The tools, as a kit checklist needs them.
 *
 * Read fresh every time a sheet is asked for, which is what makes the printed
 * thing true: a tool added to a kit this morning is on the sheet printed this
 * afternoon, and there is no saved copy anywhere to go stale.
 *
 * Only tools we actually have. A checklist that lists something sold last year
 * is a checklist somebody spends ten minutes looking for it on.
 */
export async function listKitTools(): Promise<KitTool[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tools")
    .select("id, name, description, image_path, how_to_url, storage_location, quantity, kits, kit_quantities, active")
    .eq("active", true)
    .order("name");
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    imagePath: row.image_path ?? null,
    howToUrl: row.how_to_url ?? null,
    storageLocation: row.storage_location ?? null,
    quantity: row.quantity ?? null,
    kits: (row.kits ?? []) as number[],
    kitQuantities: (row.kit_quantities ?? {}) as Record<string, number>,
  }));
}

/**
 * A tool's photograph at a size worth printing.
 *
 * Storage resizes it on the way out, so a four megabyte phone photo does not
 * become four megabytes of PDF. The bucket is public, which is why this is a
 * plain URL rather than a signed one.
 */
export function toolPhotoJpegUrl(path: string, width: number, height: number): string {
  const base = env.supabaseUrl.replace(/\/$/, "");
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const query = new URLSearchParams({
    width: String(Math.round(width)),
    height: String(Math.round(height)),
    resize: "contain",
    quality: "80",
  });
  return `${base}/storage/v1/render/image/public/tool-images/${encoded}?${query.toString()}`;
}

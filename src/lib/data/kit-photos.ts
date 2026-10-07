import { createClient } from "@/lib/supabase/server";
import { kitPhotoUrl } from "@/lib/kit-photos";

/** Each kit's photo, by kit number, ready to show. A kit with no photo is left out. */
export async function getKitPhotos(): Promise<Record<number, string>> {
  const supabase = await createClient();
  const { data } = await supabase.from("kit_photos").select("kit, image_path");
  return Object.fromEntries(((data ?? []) as { kit: number; image_path: string }[]).map((row) => [row.kit, kitPhotoUrl(row.image_path)]));
}

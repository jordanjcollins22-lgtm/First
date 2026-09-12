import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import type { FlyerAd } from "@/lib/flyer";

/** Every square that has something in it. Empty ones have no row at all. */
export async function listFlyerAds(): Promise<FlyerAd[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("flyer_ad_spots")
    .select("id, slot, business_name, contact, image_path, price, notes")
    .order("slot");

  if (isMissingTable(error) || error) return [];

  return ((data ?? []) as unknown as {
    id: string;
    slot: number;
    business_name: string | null;
    contact: string | null;
    image_path: string | null;
    price: number | null;
    notes: string | null;
  }[]).map((row) => ({
    id: row.id,
    slot: Number(row.slot),
    businessName: row.business_name,
    contact: row.contact,
    imagePath: row.image_path,
    price: row.price != null ? Number(row.price) : null,
    notes: row.notes,
  }));
}

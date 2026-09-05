"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { describeDbError } from "@/lib/setup-errors";
import { SLOTS } from "@/lib/flyer";

export type FlyerResult = { ok: true; message?: string } | { ok: false; message: string };

/**
 * Puts an advert in a square, or edits the one already there.
 *
 * One row per square, so booking the same square twice overwrites rather than
 * stacking — two adverts in one square is a mistake nobody finds until five
 * thousand are printed.
 */
export async function saveFlyerAd(input: {
  slot: number;
  businessName?: string;
  contact?: string;
  imagePath?: string | null;
  price?: number | null;
  notes?: string;
}): Promise<FlyerResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    if (!SLOTS.some((s) => s.slot === input.slot)) {
      return { ok: false, message: "There is no such square on the sheet." };
    }

    const [supabase, organizationId] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
    ]);

    const { error } = await supabase.from("flyer_ad_spots").upsert(
      {
        organization_id: organizationId,
        slot: input.slot,
        business_name: input.businessName?.trim() || null,
        contact: input.contact?.trim() || null,
        image_path: input.imagePath ?? null,
        price: input.price ?? null,
        notes: input.notes?.trim() || null,
        created_by: profile.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,slot" }
    );

    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath("/admin/flyer");
    return { ok: true, message: "Saved." };
  } catch (err) {
    console.error("saveFlyerAd failed:", err);
    return { ok: false, message: "Couldn't save that square." };
  }
}

/** Empties a square back to "your ad here". */
export async function clearFlyerAd(slot: number): Promise<FlyerResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const { error } = await supabase.from("flyer_ad_spots").delete().eq("slot", slot);
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath("/admin/flyer");
    return { ok: true, message: "Square is open again." };
  } catch (err) {
    console.error("clearFlyerAd failed:", err);
    return { ok: false, message: "Couldn't clear that square." };
  }
}

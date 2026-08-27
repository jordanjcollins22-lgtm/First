"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { describeDbError } from "@/lib/setup-errors";
import { SIDES, type HangerSide } from "@/lib/door-hanger";

export type DoorHangerResult = { ok: true; message?: string } | { ok: false; message: string };

/** Puts artwork on one half of the sheet, or renames what is there. */
export async function saveDoorHanger(input: {
  side: HangerSide;
  imagePath?: string | null;
  label?: string;
}): Promise<DoorHangerResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };
    if (!SIDES.includes(input.side)) return { ok: false, message: "There is no such half." };

    const [supabase, organizationId] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
    ]);

    const { error } = await supabase.from("door_hanger_slots").upsert(
      {
        organization_id: organizationId,
        side: input.side,
        image_path: input.imagePath ?? null,
        label: input.label?.trim() || null,
        created_by: profile.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,side" }
    );

    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath("/admin/door-hangers");
    return { ok: true, message: "Saved." };
  } catch (err) {
    console.error("saveDoorHanger failed:", err);
    return { ok: false, message: "Couldn't save that half." };
  }
}

/** Empties one half back to the bare die line. */
export async function clearDoorHanger(side: HangerSide): Promise<DoorHangerResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const { error } = await supabase.from("door_hanger_slots").delete().eq("side", side);
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath("/admin/door-hangers");
    return { ok: true, message: "Cleared." };
  } catch (err) {
    console.error("clearDoorHanger failed:", err);
    return { ok: false, message: "Couldn't clear that half." };
  }
}

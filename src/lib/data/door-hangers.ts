import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import type { HangerSide, HangerSlot } from "@/lib/door-hanger";

/** The artwork on each half of the sheet. */
export async function listDoorHangerSlots(): Promise<HangerSlot[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("door_hanger_slots")
    .select("side, image_path, label")
    .order("side");

  if (isMissingTable(error) || error) return [];

  return ((data ?? []) as { side: string; image_path: string | null; label: string | null }[]).map(
    (row) => ({
      side: row.side as HangerSide,
      imagePath: row.image_path,
      label: row.label,
    })
  );
}

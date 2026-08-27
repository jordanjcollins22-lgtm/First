import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import type { HangerFace, HangerSide, HangerSlot } from "@/lib/door-hanger";

/** The artwork on each half of the sheet. */
export async function listDoorHangerSlots(): Promise<HangerSlot[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("door_hanger_slots")
    .select("side, face, image_path, label")
    .order("side");

  if (isMissingTable(error) || error) return [];

  return (
    (data ?? []) as {
      side: string;
      face: string;
      image_path: string | null;
      label: string | null;
    }[]
  ).map((row) => ({
    side: row.side as HangerSide,
    face: (row.face as HangerFace) ?? "front",
    imagePath: row.image_path,
    label: row.label,
  }));
}

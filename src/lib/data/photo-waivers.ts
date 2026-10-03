import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import type { JobPhotoStage } from "@/types/domain";

export interface StoredWaiver {
  zoneId: string | null;
  stage: JobPhotoStage;
  reason: string | null;
  waivedByName: string | null;
}

/** The stages somebody has said there is no photo of. */
export async function listPhotoWaivers(jobId: string): Promise<StoredWaiver[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("job_photo_waivers")
    .select("zone_id, stage, reason, profiles:waived_by(full_name, email)")
    .eq("job_id", jobId);

  if (isMissingTable(error) || error) return [];

  return ((data ?? []) as unknown as {
    zone_id: string | null;
    stage: string;
    reason: string | null;
    profiles: { full_name: string | null; email: string | null } | null;
  }[]).map((row) => ({
    zoneId: row.zone_id,
    stage: row.stage as JobPhotoStage,
    reason: row.reason,
    waivedByName: row.profiles?.full_name || row.profiles?.email || null,
  }));
}

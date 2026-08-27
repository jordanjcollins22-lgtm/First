"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { describeDbError } from "@/lib/setup-errors";
import type { JobPhotoStage } from "@/types/domain";

export type WaiverResult = { ok: true; message?: string } | { ok: false; message: string };

/**
 * Records that there is no photo of this stage, and who said so.
 *
 * The name matters more than the reason. A stage that closes with nobody
 * attached to it is a gap that closed itself.
 */
export async function waivePhotoStage(input: {
  jobId: string;
  zoneId: string | null;
  stage: JobPhotoStage;
  reason?: string;
}): Promise<WaiverResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const [supabase, organizationId] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
    ]);

    const { error } = await supabase.from("job_photo_waivers").upsert(
      {
        job_id: input.jobId,
        organization_id: organizationId,
        zone_id: input.zoneId,
        stage: input.stage,
        reason: input.reason?.trim() || null,
        waived_by: profile.id,
      },
      { onConflict: "job_id,zone_id,stage" }
    );

    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath(`/jobs/${input.jobId}`);
    revalidatePath("/admin/social");
    return { ok: true, message: "Marked as not available." };
  } catch (err) {
    console.error("waivePhotoStage failed:", err);
    return { ok: false, message: "Couldn't mark that." };
  }
}

/** Takes the waiver back, so the stage is owed again. */
export async function unwaivePhotoStage(input: {
  jobId: string;
  zoneId: string | null;
  stage: JobPhotoStage;
}): Promise<WaiverResult> {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("job_photo_waivers")
      .delete()
      .eq("job_id", input.jobId)
      .eq("stage", input.stage);

    query = input.zoneId == null ? query.is("zone_id", null) : query.eq("zone_id", input.zoneId);

    const { error } = await query;
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath(`/jobs/${input.jobId}`);
    return { ok: true, message: "Owed again." };
  } catch (err) {
    console.error("unwaivePhotoStage failed:", err);
    return { ok: false, message: "Couldn't undo that." };
  }
}

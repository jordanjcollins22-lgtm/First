"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { PhotoStage } from "@/types/domain";

async function getJobIdForWorkArea(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workAreaId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("work_areas")
    .select("job_id")
    .eq("id", workAreaId)
    .maybeSingle();
  return data?.job_id ?? null;
}

export async function recordPhoto(
  workAreaId: string,
  storagePath: string,
  stage: PhotoStage = "reference",
  caption?: string
) {
  const supabase = await createClient();
  const { error } = await supabase.from("photos").insert({
    work_area_id: workAreaId,
    storage_path: storagePath,
    stage,
    caption: caption ?? null,
  });
  if (error) throw error;

  const jobId = await getJobIdForWorkArea(supabase, workAreaId);
  if (jobId) {
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/jobs/${jobId}/crew`);
  }
}

export async function deletePhoto(photoId: string) {
  const supabase = await createClient();
  const { data: photo, error: fetchError } = await supabase
    .from("photos")
    .select("work_area_id, storage_path")
    .eq("id", photoId)
    .single();
  if (fetchError) throw fetchError;

  const { error } = await supabase.from("photos").delete().eq("id", photoId);
  if (error) throw error;

  await supabase.storage.from("work-area-photos").remove([photo.storage_path]);

  const jobId = await getJobIdForWorkArea(supabase, photo.work_area_id);
  if (jobId) {
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/jobs/${jobId}/crew`);
  }
}

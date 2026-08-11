"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export async function assignJob(jobId: string, profileId: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update({ assigned_to: profileId }).eq("id", jobId);
  if (error) throw error;
  revalidatePath("/attractors");
}

export async function updateJobDates(
  jobId: string,
  dates: { evaluationDate?: string | null; projectStartDate?: string | null }
) {
  const patch: { evaluation_date?: string | null; project_start_date?: string | null } = {};
  if (dates.evaluationDate !== undefined) patch.evaluation_date = dates.evaluationDate;
  if (dates.projectStartDate !== undefined) patch.project_start_date = dates.projectStartDate;

  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
  if (error) throw error;
  revalidatePath("/attractors");
}

"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { generateProposal } from "@/lib/actions/proposal-actions";
import type { EvaluationStatus } from "@/types/domain";

export async function updateEvaluationStatus(jobId: string, status: EvaluationStatus) {
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update({ evaluation_status: status }).eq("id", jobId);
  if (error) throw error;

  if (status === "completed") {
    // Best-effort — an evaluation with nothing on it yet shouldn't block submission.
    await generateProposal(jobId).catch(() => {});
  }

  revalidatePath("/attractors");
  revalidatePath(`/jobs/${jobId}`);
}

export async function updateJobStatus(jobId: string, status: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update({ status }).eq("id", jobId);
  if (error) throw error;
  revalidatePath("/attractors");
}

export async function assignJob(jobId: string, profileId: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update({ assigned_to: profileId }).eq("id", jobId);
  if (error) throw error;
  revalidatePath("/attractors");
}

export async function updateJobDates(
  jobId: string,
  dates: { evaluationDate?: string | null; projectStartDate?: string | null; projectEndDate?: string | null }
) {
  const patch: { evaluation_date?: string | null; project_start_date?: string | null; project_end_date?: string | null } = {};
  if (dates.evaluationDate !== undefined) patch.evaluation_date = dates.evaluationDate;
  if (dates.projectStartDate !== undefined) patch.project_start_date = dates.projectStartDate;
  if (dates.projectEndDate !== undefined) patch.project_end_date = dates.projectEndDate;

  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
  if (error) throw error;
  revalidatePath("/attractors");
}

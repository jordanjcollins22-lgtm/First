"use server";

import { revalidatePath } from "next/cache";

import { getPreEvalForClient } from "@/lib/data/pre-evals";
import { parsePreEvalTaps } from "@/lib/pre-eval";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Estimator: returns the job's pre-eval id, making one the first time. */
export async function getOrCreatePreEvalLink(jobId: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pre_evals")
    .upsert({ job_id: jobId }, { onConflict: "job_id", ignoreDuplicates: false })
    .select("id")
    .single();
  if (error) throw error;
  revalidatePath(`/jobs/${jobId}`);
  return data.id;
}

/** Client: saves the spots they tapped. Sending again replaces the old ones. */
export async function submitPreEval(id: string, taps: unknown): Promise<{ error?: string }> {
  const preEval = await getPreEvalForClient(id);
  if (!preEval) return { error: "This link isn't valid anymore. Please contact us." };

  const parsed = parsePreEvalTaps(taps, preEval);
  if (!parsed) return { error: "Some of those spots are off your property. Tap closer to home." };
  if (parsed.length === 0) return { error: "Tap at least one area first." };

  const now = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("pre_evals")
    .update({ taps: parsed, submitted_at: now, updated_at: now })
    .eq("id", id);
  if (error) {
    console.error("[pre-eval] submit failed", error);
    return { error: "Something went wrong. Please try again." };
  }
  return {};
}

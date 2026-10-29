"use server";

import { revalidatePath } from "next/cache";
import { v4 as uuid } from "uuid";

import { getPreEvalForClient, listPreEvalServices } from "@/lib/data/pre-evals";
import { parsePreEvalSpots, PRE_EVAL_PHOTO_BUCKET } from "@/lib/pre-eval";
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

/**
 * Client: a one-time upload URL for one photo. Phone photos are too big for a
 * server action body, so the browser uploads straight to storage.
 */
export async function createPreEvalPhotoUpload(
  preEvalId: string
): Promise<{ path: string; token: string } | { error: string }> {
  const preEval = await getPreEvalForClient(preEvalId);
  if (!preEval) return { error: "This link isn't valid anymore. Please contact us." };

  const path = `${preEvalId}/${uuid()}.jpg`;
  const { data, error } = await createAdminClient()
    .storage.from(PRE_EVAL_PHOTO_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[pre-eval] signed upload url failed", error);
    return { error: "Couldn't upload that photo. Please try again." };
  }
  return { path, token: data.token };
}

/** Client: saves their spots. Sending again replaces the old ones. */
export async function submitPreEval(id: string, spots: unknown): Promise<{ error?: string }> {
  const [preEval, services] = await Promise.all([getPreEvalForClient(id), listPreEvalServices()]);
  if (!preEval) return { error: "This link isn't valid anymore. Please contact us." };

  const parsed = parsePreEvalSpots(spots, {
    preEvalId: id,
    property: preEval,
    serviceIds: new Set(services.map((s) => s.id)),
  });
  if (!parsed) return { error: "Something about those spots didn't look right. Please try again." };
  if (parsed.length === 0) return { error: "Tap at least one area first." };

  const now = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("pre_evals")
    .update({ spots: parsed, submitted_at: now, updated_at: now })
    .eq("id", id);
  if (error) {
    console.error("[pre-eval] submit failed", error);
    return { error: "Something went wrong. Please try again." };
  }
  return {};
}

"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";

/**
 * The staff half of asking for a tip: minting the link and turning it off.
 *
 * The client half runs on the service role in its own file, because the person
 * who opens it has no account and never will.
 */

export type TipActionResult = { ok: true; token?: string } | { ok: false; message: string };

/** Long enough that guessing is not a strategy, short enough to read aloud. */
function mintToken(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Open the ask on a finished job.
 *
 * Only on a finished one. A tip request on a job still running reads as a
 * demand for a deposit by another name, and the point of the whole thing is
 * that it arrives when the garden looks the way they hoped it would.
 *
 * The job's total is copied onto the row rather than looked up later, so the
 * suggested amounts do not quietly change if somebody edits the proposal after
 * the link went out.
 */
export async function askForTip(jobId: string): Promise<TipActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };

  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("id, status")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return { ok: false, message: "That job isn't there." };
  if (job.status !== "completed") {
    return { ok: false, message: "Finish the job first — a tip link on running work reads as a demand." };
  }

  // Already asked. Handed back rather than refused: somebody pressing this
  // twice wants the link, not an error about having pressed it before.
  const { data: existing } = await supabase
    .from("job_tips")
    .select("token")
    .eq("job_id", jobId)
    .maybeSingle();
  if (existing) return { ok: true, token: existing.token };

  const { data: proposal } = await supabase
    .from("job_proposals")
    .select("total_cost")
    .eq("job_id", jobId)
    .maybeSingle();

  const token = mintToken();
  const { error } = await supabase.from("job_tips").insert({
    organization_id: profile.organization_id,
    job_id: jobId,
    token,
    status: "asked",
    job_total_cents:
      proposal?.total_cost != null ? Math.round(Number(proposal.total_cost) * 100) : null,
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, token };
}

/**
 * Take the ask back.
 *
 * Deletes rather than flags, and only while nothing has been paid. A client
 * who left twenty dollars and then finds the link dead has been given a reason
 * to wonder where it went, and there is no version of that conversation worth
 * the tidier table.
 */
export async function stopAskingForTip(jobId: string): Promise<TipActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };

  const supabase = await createClient();
  const { data: tip } = await supabase
    .from("job_tips")
    .select("id, status")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!tip) return { ok: true };
  if (tip.status === "paid") {
    return { ok: false, message: "This one was already paid. The record stays." };
  }

  const { error } = await supabase.from("job_tips").delete().eq("id", tip.id);
  if (error) return { ok: false, message: error.message };

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

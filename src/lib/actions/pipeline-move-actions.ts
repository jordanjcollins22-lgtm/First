"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { cancelJob } from "@/lib/actions/job-actions";
import { revalidateJobViews } from "@/lib/revalidate-job";
import {
  STAGE_STATUSES,
  derivedPosition,
  type PipelineStage,
} from "@/lib/pipeline";

export type MoveResponse = { ok: true; status: string } | { ok: false; message: string };

/**
 * Putting a job somewhere on the board by hand.
 *
 * The stage is derived from what is already true, and that is right nearly
 * always. Nearly: a client says yes on the phone while the proposal still
 * says sent, an evaluation happened but nobody pressed the button, work
 * started early as a favour. The board is wrong in those and there is nothing
 * to correct it with, because what would correct it is the paperwork that has
 * not caught up.
 *
 * So the move is recorded against the answer it is overriding rather than on
 * its own. The moment the facts move, the placement is about a situation that
 * has passed and the board goes back to reading the job — which is the whole
 * reason the stage was never stored in the first place.
 */
export async function moveJobOnPipeline(
  jobId: string,
  stage: PipelineStage,
  status: string,
  note?: string
): Promise<MoveResponse> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };

    if (!(STAGE_STATUSES[stage] ?? []).includes(status)) {
      return { ok: false, message: "That isn't a place on the board." };
    }

    const supabase = await createClient();
    const { data: job, error } = await supabase
      .from("jobs")
      .select("id, status, evaluation_status, evaluation_date, project_start_date, project_end_date")
      .eq("id", jobId)
      .maybeSingle();
    if (error) return { ok: false, message: error.message };
    if (!job) return { ok: false, message: "Couldn't find that job." };

    const { data: proposal } = await supabase
      .from("job_proposals")
      .select("status")
      .eq("job_id", jobId)
      .maybeSingle();

    // What the board would say on its own. Stored with the move, so the move
    // can be known to be stale later rather than outliving its reason.
    const from = derivedPosition({
      status: job.status,
      evaluationStatus: job.evaluation_status,
      evaluationDate: job.evaluation_date,
      projectStartDate: job.project_start_date,
      projectEndDate: job.project_end_date,
      proposalStatus: proposal?.status ?? null,
    }).status;

    // Declining is the one move that is a fact rather than a note about a
    // moment. "They said no" does not stop being true when the visit is
    // rescheduled or the quote regenerated, and stored as an override it did:
    // the placement went stale, the board went back to reading the raw row,
    // and the job came back as a live quote for somebody to chase.
    //
    // Moving it anywhere else clears the date, because that is somebody
    // saying the decline is over.
    const declining = stage === "sales" && status === "Declined";
    // Finishing is a fact too. Moved to Completed as a note only, the job
    // kept its old status underneath and every other screen went on
    // treating it as live work: My Day kept it, the proposals list kept
    // it, the count of open jobs kept it. So the move sets the status.
    const finishing = stage === "operations" && status === "Completed";
    const now = new Date().toISOString();

    const { error: saveError } = await supabase
      .from("jobs")
      .update({
        pipeline_override_stage: stage,
        pipeline_override_status: status,
        pipeline_override_from: from,
        pipeline_override_at: now,
        pipeline_override_by: profile.id,
        pipeline_override_note: note?.trim() || null,
        declined_at: declining ? now : null,
        declined_by: declining ? profile.id : null,
        declined_reason: declining ? note?.trim() || null : null,
        ...(finishing ? { status: "completed", completed_at: now, completed_by: profile.id } : {}),
      })
      .eq("id", jobId);
    if (saveError) return { ok: false, message: saveError.message };

    revalidateJobViews(jobId);
    return { ok: true, status };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't move that." };
  }
}

/** Back to being read off the job. */
export async function clearPipelineOverride(jobId: string): Promise<MoveResponse> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Not signed in." };

    const supabase = await createClient();
    const { error } = await supabase
      .from("jobs")
      .update({
        pipeline_override_stage: null,
        pipeline_override_status: null,
        pipeline_override_from: null,
        pipeline_override_at: null,
        pipeline_override_by: null,
        pipeline_override_note: null,
        // Back to reading the job means back to reading it about this too.
        // A decline the client made on their own proposal is on the proposal
        // and comes back from there; this only clears one made by hand.
        declined_at: null,
        declined_by: null,
        declined_reason: null,
      })
      .eq("id", jobId);
    if (error) return { ok: false, message: error.message };

    revalidateJobViews(jobId);
    return { ok: true, status: "automatic" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't reset that." };
  }
}

export type CloseHow = "declined" | "finished" | "cancelled";

/**
 * Take a job off the board, for good, everywhere.
 *
 * Three ways a job stops being live work, and each is written as the fact
 * it is rather than as a placement: they said no (declined), the work is
 * done (completed), or it is not happening (cancelled). Every screen that
 * lists live work reads those facts, so the job leaves My Day, the call
 * list, the proposals list and the calendar in the same moment it leaves
 * the board.
 */
export async function closeJob(jobId: string, how: CloseHow, note?: string): Promise<MoveResponse> {
  if (how === "declined") return moveJobOnPipeline(jobId, "sales", "Declined", note);
  if (how === "finished") return moveJobOnPipeline(jobId, "operations", "Completed", note);
  const result = await cancelJob(jobId, note?.trim() || null);
  return result.ok ? { ok: true, status: "Cancelled" } : { ok: false, message: result.message };
}


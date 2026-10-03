"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { isAccountManager } from "@/lib/affiliate-roles";
import { cancelEstimate, scheduleEstimate } from "@/lib/actions/job-actions";
import { rescheduleWorkSession } from "@/lib/actions/work-session-actions";
import { cancelNote, movedEvaluation, movedVisit } from "@/lib/client-change";

/**
 * The client rang to move or call off today's visit, and the account
 * manager did it from the card on their progress bar. Each goes through the
 * same action the job page uses, so the checks (clashes, the calendar, the
 * confirmation) are the same ones. Owners, admins and account managers only.
 */

export type ClientChangeResult = { ok: true; message: string } | { ok: false; message: string };

async function allowed(): Promise<string | null> {
  const profile = await getCurrentProfile();
  if (!profile) return "Sign in first.";
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin") && !isAccountManager(profile.roles)) {
    return "Only an owner, admin or account manager can move or cancel a visit.";
  }
  return null;
}

function refresh() {
  revalidatePath("/my-day");
}

/** The evaluation to a new day and time, the same length as it was booked for. */
export async function moveEvaluationForClient(jobId: string, date: string, time: string): Promise<ClientChangeResult> {
  const refused = await allowed();
  if (refused) return { ok: false, message: refused };
  const supabase = await createClient();
  const { data } = await supabase.from("jobs").select("evaluation_date, evaluation_end_date").eq("id", jobId).maybeSingle();
  const job = data as { evaluation_date: string | null; evaluation_end_date: string | null } | null;
  if (!job?.evaluation_date) return { ok: false, message: "Couldn't find that evaluation." };
  const moved = movedEvaluation({ start: job.evaluation_date, end: job.evaluation_end_date }, date, time, new Date());
  if (!moved.ok) return { ok: false, message: moved.reason };
  const result = await scheduleEstimate(jobId, moved.value.start, moved.value.end);
  refresh();
  return result.ok ? { ok: true, message: "Evaluation moved." } : { ok: false, message: result.message ?? "Couldn't move it." };
}

/** The evaluation called off, with what the client said. */
export async function cancelEvaluationForClient(jobId: string, reason: string): Promise<ClientChangeResult> {
  const refused = await allowed();
  if (refused) return { ok: false, message: refused };
  const note = cancelNote(reason);
  if (!note.ok) return { ok: false, message: note.reason };
  const result = await cancelEstimate(jobId, note.value);
  refresh();
  return result.ok ? { ok: true, message: "Evaluation cancelled." } : { ok: false, message: result.message ?? "Couldn't cancel it." };
}

/** Today's work visit to a new day, running as many days as it did. */
export async function moveVisitForClient(visitId: string, date: string): Promise<ClientChangeResult> {
  const refused = await allowed();
  if (refused) return { ok: false, message: refused };
  const supabase = await createClient();
  const { data } = await supabase.from("job_work_sessions").select("starts_on, ends_on").eq("id", visitId).maybeSingle();
  const visit = data as { starts_on: string; ends_on: string } | null;
  if (!visit) return { ok: false, message: "Couldn't find that visit." };
  const moved = movedVisit({ startsOn: visit.starts_on, endsOn: visit.ends_on }, date, new Date());
  if (!moved.ok) return { ok: false, message: moved.reason };
  const result = await rescheduleWorkSession(visitId, moved.value.startsOn, moved.value.endsOn);
  refresh();
  return result.ok ? { ok: true, message: "Visit moved." } : { ok: false, message: result.message ?? "Couldn't move it." };
}

/**
 * Today's work visit called off. Only the visit: the job, its proposal and
 * its payment stay, and it needs a new date. Calling off the whole job
 * stays on the job page.
 */
export async function cancelVisitForClient(visitId: string, reason: string): Promise<ClientChangeResult> {
  const refused = await allowed();
  if (refused) return { ok: false, message: refused };
  const note = cancelNote(reason);
  if (!note.ok) return { ok: false, message: note.reason };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_work_sessions")
    .update({ status: "cancelled", pause_reason: note.value })
    .eq("id", visitId)
    .select("job_id")
    .maybeSingle();
  if (error || !data) return { ok: false, message: "Couldn't cancel that visit." };
  revalidatePath(`/jobs/${(data as { job_id: string }).job_id}`);
  refresh();
  return { ok: true, message: "Visit cancelled. The job needs a new date." };
}

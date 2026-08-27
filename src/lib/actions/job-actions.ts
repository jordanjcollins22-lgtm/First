"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getBusyBlocks } from "@/lib/data/busy";
import { conflictFor, describeConflict } from "@/lib/busy";
import { evaluationWindow } from "@/lib/scheduling";
import { generateProposal, type GenerateOutcome } from "@/lib/actions/proposal-actions";
import {
  canCancelEstimate,
  canCancelJob,
  canReopenJob,
  canRescheduleEstimate,
  statusAfterEstimateCancelled,
  statusAfterReopen,
} from "@/lib/job-lifecycle";
import { validateAppointment } from "@/lib/scheduling";
import { adoptEvaluationPhotosAsBefores } from "@/lib/data/adopt-befores";
import type { Database } from "@/lib/supabase/database.types";
import type { EvaluationStatus, JobStatus } from "@/types/domain";

/**
 * Submitting an evaluation, and submitting it again.
 *
 * Returns what became of the proposal rather than swallowing it. The old
 * version caught and discarded every failure, so an evaluation whose
 * proposal never regenerated still reported success — which is how paperwork
 * ends up quoting a service nobody is doing any more with nothing on screen
 * to say so.
 */
export async function updateEvaluationStatus(
  jobId: string,
  status: EvaluationStatus,
  options: { force?: boolean } = {}
): Promise<GenerateOutcome | null> {
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update({ evaluation_status: status }).eq("id", jobId);
  if (error) throw error;

  let outcome: GenerateOutcome | null = null;

  if (status === "completed") {
    outcome = await generateProposal(jobId, options).catch(() => null);
    // The zone photos taken at the evaluation are the befores. Adopting them
    // here means the crew only has to shoot the after, and a job that was
    // photographed properly cannot end up with nothing to show for it. Still
    // best-effort: a photo that fails to adopt must not lose the submission.
    await adoptEvaluationPhotosAsBefores(jobId).catch(() => {});
  }

  revalidatePath("/attractors");
  revalidatePath(`/jobs/${jobId}`);
  return outcome;
}

export async function updateJobStatus(jobId: string, status: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update({ status }).eq("id", jobId);
  if (error) throw error;
  revalidatePath("/attractors");
}

/**
 * Hands the job to somebody.
 *
 * Checked, because assigning is a way of booking: a job with an appointment on
 * it books whoever it is handed to, and this was the door that let somebody be
 * double-booked without anybody touching a date.
 */
export async function assignJob(jobId: string, profileId: string | null) {
  const supabase = await createClient();

  if (profileId) {
    const { data } = await supabase
      .from("jobs")
      .select("evaluation_date, evaluation_end_date")
      .eq("id", jobId)
      .maybeSingle();
    const dates = data as { evaluation_date: string | null; evaluation_end_date: string | null } | null;
    if (dates?.evaluation_date) {
      const clash = await findClashFor(supabase, jobId, profileId, dates.evaluation_date, dates.evaluation_end_date);
      if (clash) throw new Error(clash);
    }
  }

  const { error } = await supabase.from("jobs").update({ assigned_to: profileId }).eq("id", jobId);
  if (error) throw error;
  revalidatePath("/attractors");
}

/**
 * Moves dates from the calendar — dragging an appointment, mostly.
 *
 * Same rule as every other door: a move that lands on top of something else is
 * refused rather than saved. The calendar is the screen where a double booking
 * is easiest to create by accident, which makes it the last place to leave
 * unchecked.
 */
export async function updateJobDates(
  jobId: string,
  dates: { evaluationDate?: string | null; projectStartDate?: string | null; projectEndDate?: string | null }
) {
  const patch: { evaluation_date?: string | null; project_start_date?: string | null; project_end_date?: string | null } = {};
  if (dates.evaluationDate !== undefined) patch.evaluation_date = dates.evaluationDate;
  if (dates.projectStartDate !== undefined) patch.project_start_date = dates.projectStartDate;
  if (dates.projectEndDate !== undefined) patch.project_end_date = dates.projectEndDate;

  const supabase = await createClient();

  if (dates.evaluationDate) {
    const clash = await findClash(supabase, jobId, dates.evaluationDate, null);
    if (clash) throw new Error(clash);
  }

  const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
  if (error) throw error;
  revalidatePath("/attractors");
}

/**
 * The rest of the job's life: booking an estimate, moving it, calling it off,
 * cancelling and reopening the job itself.
 *
 * These return a result rather than throwing. Next.js strips thrown messages
 * in production, and "something went wrong" is useless when somebody is
 * standing in a driveway trying to move an appointment.
 */

export type JobActionResult = { ok: true; message?: string } | { ok: false; message: string };

type JobUpdate = Database["public"]["Tables"]["jobs"]["Update"];

/** Re-reads the row the rules need, so a decision is never made on stale UI state. */
async function loadJob(supabase: Awaited<ReturnType<typeof createClient>>, jobId: string) {
  const { data, error } = await supabase
    .from("jobs")
    .select("id, status, evaluation_status, evaluation_date, evaluation_end_date, project_start_date, project_end_date")
    .eq("id", jobId)
    .single();
  if (error || !data) return null;
  return {
    status: data.status as JobStatus,
    evaluationStatus: data.evaluation_status as EvaluationStatus,
    evaluationDate: data.evaluation_date,
    evaluationEndDate: data.evaluation_end_date,
    projectStartDate: data.project_start_date,
    projectEndDate: data.project_end_date,
  };
}

/**
 * Whether the person assigned to this job is already spoken for.
 *
 * Returns the sentence to show them, or null when the slot is clear. Reads
 * every calendar rather than only evaluations, which is the whole point:
 * a double booking that only one screen can see is still a double booking.
 */
async function findClash(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string,
  startIso: string,
  endIso: string | null
): Promise<string | null> {
  const { data } = await supabase.from("jobs").select("assigned_to").eq("id", jobId).maybeSingle();
  const assignedTo = (data as { assigned_to: string | null } | null)?.assigned_to ?? null;
  // Nobody assigned means nobody to double-book. The office schedules first
  // and assigns second often enough that refusing here would be wrong.
  if (!assignedTo) return null;
  return findClashFor(supabase, jobId, assignedTo, startIso, endIso);
}

/** The same question about a named person, for the moment somebody is being
 * handed a job that already has an appointment on it. */
async function findClashFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string,
  profileId: string,
  startIso: string,
  endIso: string | null
): Promise<string | null> {
  const window = evaluationWindow(startIso, endIso);
  if (!window) return null;

  const blocks = await getBusyBlocks().catch(() => []);
  const clash = conflictFor(blocks, profileId, window, jobId);
  if (!clash) return null;

  const { data: person } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", profileId)
    .maybeSingle();
  const name = person as { full_name: string | null; email: string } | null;

  return describeConflict(clash, name?.full_name || name?.email || null);
}

function refresh(jobId: string) {
  revalidatePath("/attractors");
  revalidatePath("/evaluations");
  revalidatePath("/pipeline");
  revalidatePath(`/jobs/${jobId}`);
}

/**
 * Adds another job at a property that already has one.
 *
 * Creating a property from the home screen jumps to its existing job rather
 * than making a second one, which is right for a first visit and wrong for
 * repeat work. This is the way to book the second job.
 */
export async function createJobAtProperty(propertyId: string, name: string): Promise<JobActionResult> {
  try {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, message: "Give the job a name." };

    const supabase = await createClient();
    const { data: property, error: propertyError } = await supabase
      .from("properties")
      .select("id, address")
      .eq("id", propertyId)
      .single();
    if (propertyError || !property) return { ok: false, message: "Couldn't find that property." };

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({ property_id: propertyId, name: trimmed })
      .select("id")
      .single();
    if (error || !job) return { ok: false, message: error?.message ?? "Couldn't create that job." };

    revalidatePath("/attractors");
    revalidatePath("/pipeline");
    return { ok: true, message: job.id };
  } catch (err) {
    console.error("createJobAtProperty failed:", err);
    return { ok: false, message: "Couldn't create that job." };
  }
}

/**
 * Books or moves the estimate visit, as a window rather than an instant.
 *
 * An end time is what makes a double booking detectable and what tells an
 * evaluator how much of their day this takes. Leaving it blank is allowed —
 * the default length fills in — but clearing the start unbooks the visit.
 *
 * Rebooking a cancelled visit puts it back to scheduled: cancelling an
 * appointment shouldn't be a one-way door.
 */
export async function scheduleEstimate(
  jobId: string,
  date: string | null,
  endDate: string | null = null
): Promise<JobActionResult> {
  try {
    const supabase = await createClient();
    const job = await loadJob(supabase, jobId);
    if (!job) return { ok: false, message: "Couldn't find that job." };

    const verdict = canRescheduleEstimate(job);
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const window = validateAppointment(date, endDate);
    if (!window.ok) return { ok: false, message: window.reason };

    // The person is the resource, not the calendar. Somebody already on a job
    // that morning is not free for an evaluation just because the job sits on
    // a different calendar — and the office could book exactly that until now.
    // The job's own appointment is ignored, or nothing could ever be moved.
    const clash = date ? await findClash(supabase, jobId, date, endDate) : null;
    if (clash) return { ok: false, message: clash };

    const patch: JobUpdate = {
      evaluation_date: date,
      // Clearing the start clears the end with it, so a stale end can never
      // outlive the appointment it belonged to.
      evaluation_end_date: date ? endDate : null,
    };
    if (date && job.evaluationStatus === "cancelled") patch.evaluation_status = "scheduled";

    const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
    if (error) return { ok: false, message: error.message };

    refresh(jobId);
    return { ok: true, message: date ? "Estimate scheduled." : "Estimate taken off the calendar." };
  } catch (err) {
    console.error("scheduleEstimate failed:", err);
    return { ok: false, message: "Couldn't schedule that." };
  }
}

/**
 * Calls off the estimate visit.
 *
 * The date stays on the row rather than being wiped, so the calendar history
 * still shows a visit was planned for that day and who lost it.
 */
export async function cancelEstimate(jobId: string, reason: string | null): Promise<JobActionResult> {
  try {
    const supabase = await createClient();
    const job = await loadJob(supabase, jobId);
    if (!job) return { ok: false, message: "Couldn't find that job." };

    const verdict = canCancelEstimate(job);
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const nextStatus = statusAfterEstimateCancelled(job.status);
    const patch: JobUpdate = {
      evaluation_status: "cancelled",
      cancellation_reason: reason?.trim() || null,
    };
    if (nextStatus !== job.status) {
      patch.status = nextStatus;
      patch.cancelled_at = new Date().toISOString();
    }

    const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
    if (error) return { ok: false, message: error.message };

    refresh(jobId);
    return {
      ok: true,
      message:
        nextStatus === "cancelled"
          ? "Estimate cancelled, and the job closed with it."
          : "Estimate cancelled. The job is still open.",
    };
  } catch (err) {
    console.error("cancelEstimate failed:", err);
    return { ok: false, message: "Couldn't cancel that estimate." };
  }
}

/**
 * Cancels the job.
 *
 * Work dates are cleared so it stops occupying the calendar, but nothing is
 * deleted — the proposal, the messages and the estimate history all stay, so
 * reopening it later brings the whole thing back.
 */
export async function cancelJob(jobId: string, reason: string | null): Promise<JobActionResult> {
  try {
    const supabase = await createClient();
    const job = await loadJob(supabase, jobId);
    if (!job) return { ok: false, message: "Couldn't find that job." };

    const verdict = canCancelJob(job);
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const { error } = await supabase
      .from("jobs")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason?.trim() || null,
        project_start_date: null,
        project_end_date: null,
      })
      .eq("id", jobId);
    if (error) return { ok: false, message: error.message };

    refresh(jobId);
    return { ok: true, message: "Job cancelled and taken off the calendar." };
  } catch (err) {
    console.error("cancelJob failed:", err);
    return { ok: false, message: "Couldn't cancel that job." };
  }
}

/** Puts a cancelled job back, at whatever stage its own history says it reached. */
export async function reopenJob(jobId: string): Promise<JobActionResult> {
  try {
    const supabase = await createClient();
    const job = await loadJob(supabase, jobId);
    if (!job) return { ok: false, message: "Couldn't find that job." };

    const verdict = canReopenJob(job);
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const { error } = await supabase
      .from("jobs")
      .update({ status: statusAfterReopen(job), cancelled_at: null, cancellation_reason: null })
      .eq("id", jobId);
    if (error) return { ok: false, message: error.message };

    refresh(jobId);
    return { ok: true, message: "Job reopened. Put it back on the calendar when you have a date." };
  } catch (err) {
    console.error("reopenJob failed:", err);
    return { ok: false, message: "Couldn't reopen that job." };
  }
}

/**
 * Sets or clears the work dates directly.
 *
 * Refuses when the job has visits, because then the columns are a projection
 * of those visits maintained by trigger and anything written here would be
 * silently overwritten by the next session change.
 *
 * It exists for the case that leaves people stranded otherwise: a job carrying
 * dates from before visits were tracked, or from an import, with no session to
 * edit them through. Read-only wrong dates and no way to fix them is worse
 * than one editor that knows when to stand aside.
 */
export async function setJobWorkDates(
  jobId: string,
  start: string | null,
  end: string | null
): Promise<JobActionResult> {
  try {
    const supabase = await createClient();

    const { count } = await supabase
      .from("job_work_sessions")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .neq("status", "cancelled");

    if ((count ?? 0) > 0) {
      return {
        ok: false,
        message: "This job has visits booked — change the dates there and these follow automatically.",
      };
    }

    if (start && end && end < start) {
      return { ok: false, message: "The end date is before the start date." };
    }
    if (!start && end) {
      return { ok: false, message: "Give it a start date as well as an end date." };
    }

    const { error } = await supabase
      .from("jobs")
      .update({ project_start_date: start, project_end_date: end })
      .eq("id", jobId);
    if (error) return { ok: false, message: error.message };

    refresh(jobId);
    return { ok: true, message: start ? "Work dates updated." : "Taken off the calendar." };
  } catch (err) {
    console.error("setJobWorkDates failed:", err);
    return { ok: false, message: "Couldn't change those dates." };
  }
}

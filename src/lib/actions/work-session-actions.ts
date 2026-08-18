"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { validateSession } from "@/lib/scheduling";
import { canRescheduleJob } from "@/lib/job-lifecycle";
import type {
  JobStatus,
  TicketCause,
  TicketSeverity,
  TicketStatus,
  WorkSessionStatus,
} from "@/types/domain";

export type SessionResult = { ok: true; message?: string } | { ok: false; message: string };

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/attractors");
  revalidatePath("/evaluations");
  revalidatePath("/pipeline");
}

/* ------------------------------------------------------------- work visits */

/**
 * Books another visit to the job.
 *
 * Adding a visit is how a job gets rescheduled, extended, or split across
 * three trips — jobs.project_start_date / project_end_date follow along by
 * database trigger, so the calendar never has to be told separately.
 */
export async function addWorkSession(
  jobId: string,
  startsOn: string,
  endsOn: string,
  purpose: string | null,
  ticketId: string | null = null
): Promise<SessionResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const verdict = validateSession(startsOn, endsOn);
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();

    // A cancelled or finished job should not quietly grow another visit.
    const { data: job } = await supabase.from("jobs").select("status").eq("id", jobId).single();
    if (!job) return { ok: false, message: "Couldn't find that job." };
    const allowed = canRescheduleJob({ status: job.status as JobStatus });
    if (!allowed.ok) return { ok: false, message: allowed.reason };

    const { error } = await supabase.from("job_work_sessions").insert({
      job_id: jobId,
      organization_id: organizationId,
      starts_on: startsOn,
      ends_on: endsOn,
      purpose: purpose?.trim() || null,
      ticket_id: ticketId,
      created_by: profile.id,
    });
    if (error) return { ok: false, message: error.message };

    // A ticket with a visit booked is no longer merely open.
    if (ticketId) {
      await supabase.from("job_tickets").update({ status: "scheduled" }).eq("id", ticketId);
    }

    refresh(jobId);
    return { ok: true, message: "Visit booked." };
  } catch (err) {
    console.error("addWorkSession failed:", err);
    return { ok: false, message: "Couldn't book that visit." };
  }
}

/** Moves a visit. */
export async function rescheduleWorkSession(
  id: string,
  startsOn: string,
  endsOn: string
): Promise<SessionResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const verdict = validateSession(startsOn, endsOn);
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("job_work_sessions")
      .update({ starts_on: startsOn, ends_on: endsOn })
      .eq("id", id)
      .select("job_id")
      .single();
    if (error || !data) return { ok: false, message: error?.message ?? "Couldn't move that visit." };

    refresh(data.job_id);
    return { ok: true, message: "Visit moved." };
  } catch (err) {
    console.error("rescheduleWorkSession failed:", err);
    return { ok: false, message: "Couldn't move that visit." };
  }
}

/**
 * Changes where a visit stands.
 *
 * Pausing asks for a reason, because "we stopped" without one is worthless by
 * the following week — and the reason is what tells you whether the job is
 * waiting on weather, on a supplier, or on you.
 */
export async function setWorkSessionStatus(
  id: string,
  status: WorkSessionStatus,
  pauseReason: string | null = null
): Promise<SessionResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const patch: { status: WorkSessionStatus; pause_reason?: string | null } = { status };

    if (status === "paused") {
      patch.pause_reason = pauseReason?.trim() || null;
    } else if (status === "in_progress" || status === "done") {
      // Resuming or finishing clears a stale reason, so the row never says
      // "waiting on stone" about work that has since carried on.
      patch.pause_reason = null;
    }

    const { data, error } = await supabase
      .from("job_work_sessions")
      .update(patch)
      .eq("id", id)
      .select("job_id")
      .single();
    if (error || !data) return { ok: false, message: error?.message ?? "Couldn't update that visit." };

    refresh(data.job_id);
    return { ok: true };
  } catch (err) {
    console.error("setWorkSessionStatus failed:", err);
    return { ok: false, message: "Couldn't update that visit." };
  }
}

/** Removes a visit that should never have existed. Cancelling is usually the
 * better move — it keeps the record that a trip was planned and dropped. */
export async function deleteWorkSession(id: string): Promise<SessionResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const { data: existing } = await supabase
      .from("job_work_sessions")
      .select("job_id")
      .eq("id", id)
      .single();
    if (!existing) return { ok: false, message: "That visit is already gone." };

    const { error } = await supabase.from("job_work_sessions").delete().eq("id", id);
    if (error) return { ok: false, message: error.message };

    refresh(existing.job_id);
    return { ok: true, message: "Visit removed." };
  } catch (err) {
    console.error("deleteWorkSession failed:", err);
    return { ok: false, message: "Couldn't remove that visit." };
  }
}

/* ------------------------------------------------------------------ tickets */

export interface TicketInput {
  title: string;
  detail: string | null;
  cause: TicketCause | null;
  severity: TicketSeverity;
  billable: boolean;
}

/** Raises something to go back for, against the job it came from. */
export async function openTicket(jobId: string, input: TicketInput): Promise<SessionResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };
    if (!input.title.trim()) return { ok: false, message: "Say what the problem is." };

    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();

    const { error } = await supabase.from("job_tickets").insert({
      job_id: jobId,
      organization_id: organizationId,
      title: input.title.trim(),
      detail: input.detail?.trim() || null,
      cause: input.cause,
      severity: input.severity,
      billable: input.billable,
      opened_by: profile.id,
    });
    if (error) return { ok: false, message: error.message };

    refresh(jobId);
    return { ok: true, message: "Ticket opened." };
  } catch (err) {
    console.error("openTicket failed:", err);
    return { ok: false, message: "Couldn't open that ticket." };
  }
}

/** Records the cause once somebody has actually worked out what happened. It
 * is usually not known on the day the ticket is raised. */
export async function updateTicketCause(
  id: string,
  cause: TicketCause | null,
  billable: boolean
): Promise<SessionResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("job_tickets")
      .update({ cause, billable })
      .eq("id", id)
      .select("job_id")
      .single();
    if (error || !data) return { ok: false, message: error?.message ?? "Couldn't update that ticket." };

    refresh(data.job_id);
    return { ok: true };
  } catch (err) {
    console.error("updateTicketCause failed:", err);
    return { ok: false, message: "Couldn't update that ticket." };
  }
}

/** Closes a ticket out. Resolving asks what was done, which is the half that
 * makes the record useful the next time the same thing happens. */
export async function setTicketStatus(
  id: string,
  status: TicketStatus,
  resolution: string | null = null
): Promise<SessionResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const resolving = status === "resolved" || status === "closed";
    const { data, error } = await supabase
      .from("job_tickets")
      .update({
        status,
        resolution: resolving ? resolution?.trim() || null : null,
        resolved_at: resolving ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .select("job_id")
      .single();
    if (error || !data) return { ok: false, message: error?.message ?? "Couldn't update that ticket." };

    refresh(data.job_id);
    return { ok: true };
  } catch (err) {
    console.error("setTicketStatus failed:", err);
    return { ok: false, message: "Couldn't update that ticket." };
  }
}

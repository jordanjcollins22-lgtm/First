"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { describeDbError } from "@/lib/setup-errors";
import { checkEdit } from "@/lib/time-clock";

export type ClockResult = { ok: true; message?: string } | { ok: false; message: string };

function refresh(jobId?: string | null) {
  revalidatePath("/my-day");
  revalidatePath("/admin/payments");
  if (jobId) revalidatePath(`/jobs/${jobId}`);
}

/**
 * Starts the clock.
 *
 * Closes anything already running for that person first. Somebody who moved
 * to the next job without clocking out has not been in two places at once,
 * and adding up as though they had inflates both their hours and their pay.
 */
export async function clockIn(
  jobId: string | null,
  note?: string,
  sessionId?: string | null
): Promise<ClockResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const [supabase, organizationId] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
    ]);

    const now = new Date().toISOString();

    await supabase
      .from("time_entries")
      .update({ clocked_out_at: now })
      .eq("profile_id", profile.id)
      .is("clocked_out_at", null);

    const { error } = await supabase.from("time_entries").insert({
      organization_id: organizationId,
      profile_id: profile.id,
      job_id: jobId,
      session_id: sessionId ?? null,
      clocked_in_at: now,
      note: note?.trim() || null,
    });

    if (error) return { ok: false, message: describeDbError(error) };

    refresh(jobId);
    return { ok: true, message: "On the clock." };
  } catch (err) {
    console.error("clockIn failed:", err);
    return { ok: false, message: "Couldn't start the clock." };
  }
}

/** Stops the clock on whatever the signed-in person has running. */
export async function clockOut(): Promise<ClockResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const { error } = await supabase
      .from("time_entries")
      .update({ clocked_out_at: new Date().toISOString() })
      .eq("profile_id", profile.id)
      .is("clocked_out_at", null);

    if (error) return { ok: false, message: describeDbError(error) };

    refresh();
    return { ok: true, message: "Clocked out." };
  } catch (err) {
    console.error("clockOut failed:", err);
    return { ok: false, message: "Couldn't stop the clock." };
  }
}

/**
 * Corrects an entry to what actually happened.
 *
 * Admin only, and it records who changed it. A time somebody typed and a time
 * the clock recorded are different kinds of fact — a sheet that cannot tell
 * them apart cannot be argued from, at payroll or anywhere else.
 */
export async function adjustEntry(input: {
  id: string;
  clockedInAt: string;
  clockedOutAt: string | null;
  jobId?: string | null;
  note?: string;
}): Promise<ClockResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile?.roles.includes("admin")) {
      return { ok: false, message: "Only an admin can change a logged time." };
    }

    const verdict = checkEdit(input.clockedInAt, input.clockedOutAt);
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const supabase = await createClient();
    const { error } = await supabase
      .from("time_entries")
      .update({
        clocked_in_at: new Date(input.clockedInAt).toISOString(),
        clocked_out_at: input.clockedOutAt ? new Date(input.clockedOutAt).toISOString() : null,
        ...(input.jobId !== undefined ? { job_id: input.jobId } : {}),
        ...(input.note !== undefined ? { note: input.note.trim() || null } : {}),
        edited_by: profile.id,
        edited_at: new Date().toISOString(),
      })
      .eq("id", input.id);

    if (error) return { ok: false, message: describeDbError(error) };

    refresh(input.jobId);
    return { ok: true, message: "Corrected." };
  } catch (err) {
    console.error("adjustEntry failed:", err);
    return { ok: false, message: "Couldn't change that." };
  }
}

/** Stops somebody else's clock — for the crew member who drove off with it running. */
export async function clockSomebodyOut(id: string): Promise<ClockResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile?.roles.includes("admin")) {
      return { ok: false, message: "Only an admin can clock somebody else out." };
    }

    const supabase = await createClient();
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("time_entries")
      .update({ clocked_out_at: now, edited_by: profile.id, edited_at: now })
      .eq("id", id)
      .is("clocked_out_at", null);

    if (error) return { ok: false, message: describeDbError(error) };

    refresh();
    return { ok: true, message: "Clocked out." };
  } catch (err) {
    console.error("clockSomebodyOut failed:", err);
    return { ok: false, message: "Couldn't stop that clock." };
  }
}

/** Removes an entry that should never have existed. */
export async function deleteEntry(id: string): Promise<ClockResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile?.roles.includes("admin")) {
      return { ok: false, message: "Only an admin can delete a logged time." };
    }

    const supabase = await createClient();
    const { error } = await supabase.from("time_entries").delete().eq("id", id);
    if (error) return { ok: false, message: describeDbError(error) };

    refresh();
    return { ok: true, message: "Deleted." };
  } catch (err) {
    console.error("deleteEntry failed:", err);
    return { ok: false, message: "Couldn't delete that." };
  }
}

/**
 * Writes down who worked on a visit, and for how long.
 *
 * The same rows the clock produces, entered by hand. Somebody who worked a
 * Tuesday nobody clocked has still worked it, and their hours have to reach
 * payroll and the job's cost by the same road as everybody else's — a second
 * place to record hours would be a second set of hours to disagree with the
 * first.
 */
export async function logVisitWork(input: {
  jobId: string;
  sessionId: string;
  profileId: string;
  startedAt: string;
  endedAt: string;
}): Promise<ClockResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile?.roles.includes("admin")) {
      return { ok: false, message: "Only an admin can log somebody else's hours." };
    }

    const verdict = checkEdit(input.startedAt, input.endedAt);
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const [supabase, organizationId] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
    ]);

    const now = new Date().toISOString();
    const { error } = await supabase.from("time_entries").insert({
      organization_id: organizationId,
      profile_id: input.profileId,
      job_id: input.jobId,
      session_id: input.sessionId,
      clocked_in_at: new Date(input.startedAt).toISOString(),
      clocked_out_at: new Date(input.endedAt).toISOString(),
      // Entered rather than clocked, and the sheet has to be able to say so.
      edited_by: profile.id,
      edited_at: now,
    });

    if (error) return { ok: false, message: describeDbError(error) };

    refresh(input.jobId);
    return { ok: true, message: "Logged." };
  } catch (err) {
    console.error("logVisitWork failed:", err);
    return { ok: false, message: "Couldn't log those hours." };
  }
}

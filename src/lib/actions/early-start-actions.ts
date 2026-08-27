"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { localDayKey } from "@/lib/data/crew-day";
import { notifyTeamMember } from "@/lib/notifications";

/** Results rather than throws — a thrown Server Action loses its message in
 * production and surfaces as an unexplained crash. */
export type EarlyStartResult = { ok: true } | { ok: false; message: string };

function describe(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const e = err as { message: string; code?: string };
    // The one-open-request index doing its job. A crew member who tapped
    // twice should be told they already asked, not shown a constraint name.
    if (e.code === "23505") return "You've already asked about this one.";
    return `${e.message}${e.code ? ` (${e.code})` : ""}`;
  }
  return "Something went wrong.";
}

/**
 * A crew member asking to pull the next job forward.
 *
 * Records the ask and puts it in front of whoever owns the customer. It does
 * not move the visit: the account manager decides, because they are the one
 * who told the customer when we were coming.
 */
export async function requestEarlyStart(input: {
  sessionId: string;
  note?: string | null;
}): Promise<EarlyStartResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };
    if (!input.sessionId) return { ok: false, message: "No visit to ask about." };

    const supabase = await createClient();
    const organizationId = await getCurrentOrganizationId();

    const { data: session } = await supabase
      .from("job_work_sessions")
      .select("id, job_id, status")
      .eq("id", input.sessionId)
      .maybeSingle();
    if (!session) return { ok: false, message: "That visit is no longer on the schedule." };
    if (session.status === "cancelled" || session.status === "done") {
      return { ok: false, message: "That visit is already closed." };
    }

    const { error } = await supabase.from("early_start_requests").insert({
      organization_id: organizationId,
      job_id: session.job_id,
      session_id: session.id,
      requested_by: profile.id,
      requested_for: localDayKey(),
      note: input.note?.trim() || null,
    });
    if (error) return { ok: false, message: describe(error) };

    const manager = await accountManagerFor(session.job_id);
    if (manager) {
      notifyTeamMember(
        manager,
        "schedule_requests",
        `${profile.full_name ?? "A crew member"} finished early and wants to start the next job now.`,
        { dedupeKey: `early:${session.id}` }
      ).catch(() => {
        // Best-effort. The request is recorded and shows in the queue either way.
      });
    }

    revalidatePath("/my-day");
    revalidatePath(`/jobs/${session.job_id}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/**
 * The account manager's answer.
 *
 * Approving moves the visit to today, because an approval that leaves the
 * schedule saying Thursday is an approval the crew's own screen will
 * contradict five minutes later.
 */
export async function decideEarlyStart(input: {
  requestId: string;
  approve: boolean;
  reason?: string | null;
}): Promise<EarlyStartResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const organizationId = await getCurrentOrganizationId();

    const { data: request } = await supabase
      .from("early_start_requests")
      .select("id, session_id, job_id, status")
      .eq("id", input.requestId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!request) return { ok: false, message: "That request no longer exists." };
    if (request.status !== "pending") {
      return { ok: false, message: "Somebody has already answered this one." };
    }

    // Roles here are freeform and configured per organisation, so this asks
    // the question directly rather than guessing at a role name: an admin, or
    // the person who actually owns this customer's expectations.
    const manager = await accountManagerFor(request.job_id);
    const allowed = profile.roles.includes("admin") || (manager != null && manager === profile.id);
    if (!allowed) {
      return { ok: false, message: "Only this customer's account manager can answer that." };
    }

    const { error } = await supabase
      .from("early_start_requests")
      .update({
        status: input.approve ? "approved" : "declined",
        decided_by: profile.id,
        decided_at: new Date().toISOString(),
        decline_reason: input.approve ? null : input.reason?.trim() || null,
      })
      .eq("id", request.id);
    if (error) return { ok: false, message: describe(error) };

    if (input.approve) {
      const today = localDayKey();
      // Only pull the start forward. Leaving ends_on alone would make a
      // multi-day visit shorter than the work it covers; moving it to today
      // as well would make a three-day job one day long.
      const { data: session } = await supabase
        .from("job_work_sessions")
        .select("ends_on")
        .eq("id", request.session_id)
        .maybeSingle();

      const { error: moveError } = await supabase
        .from("job_work_sessions")
        .update({
          starts_on: today,
          ends_on: session && session.ends_on < today ? today : session?.ends_on,
        })
        .eq("id", request.session_id);
      if (moveError) {
        return {
          ok: false,
          message: `Approved, but the visit could not be moved: ${describe(moveError)}`,
        };
      }
    }

    revalidatePath("/my-day");
    revalidatePath(`/jobs/${request.job_id}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/** Who owns this customer's expectations. */
async function accountManagerFor(jobId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("properties(customers(account_manager_id))")
    .eq("id", jobId)
    .maybeSingle();

  const row = data as unknown as {
    properties: { customers: { account_manager_id: string | null } | null } | null;
  } | null;
  return row?.properties?.customers?.account_manager_id ?? null;
}

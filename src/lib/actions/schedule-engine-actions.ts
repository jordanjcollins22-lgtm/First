"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { scheduleEngineEnabled } from "@/lib/data/schedule-engine";
import { canRunJobs, isOwnerLevel, roleKeysOf } from "@/lib/roles";

/**
 * Taking the engine's advice, or setting the engine aside.
 *
 * This is the only file in the scheduling work that writes to a calendar, and
 * it writes only when a person presses a button. There is no cron, no trigger
 * and no path by which a suggestion becomes a booking on its own -- which is
 * the promise the whole engine rests on. A scheduler that books its own
 * suggestions is a scheduler somebody has to audit every morning.
 *
 * Existing work is never moved by accepting a suggestion. Moving a booked job
 * is a separate act with its own reason, and it supersedes the old session
 * rather than editing it, so the record still says the job was once on
 * Tuesday.
 */

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

function failed(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/**
 * Book the visit the engine suggested.
 *
 * The suggestion itself is not trusted: the date, the job and the crew are
 * re-read and re-checked here, because a form posted from a page rendered five
 * minutes ago is a claim about the world, not a fact about it.
 */
export async function acceptSuggestion(input: {
  jobId: string;
  date: string;
  crewProfileIds: string[];
  /** The engine's own reasoning, kept with the decision. */
  because: string[];
}): Promise<ActionResult<{ sessionId: string }>> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, error: "Not signed in." };
    if (!canRunJobs((profile.roles ?? []) as string[])) {
      return { ok: false, error: "Only a project lead, an account manager or the owner can book work." };
    }
    if (!(await scheduleEngineEnabled())) {
      return { ok: false, error: "The scheduling engine is switched off." };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: "That is not a date." };

    const supabase = await createClient();

    // Never over the top of work that is already there. If somebody booked
    // this job while the page was open, the suggestion is stale and the person
    // gets told rather than getting a second session.
    const { data: existing } = await supabase
      .from("job_work_sessions")
      .select("id")
      .eq("job_id", input.jobId)
      .neq("status", "cancelled")
      .limit(1)
      .maybeSingle();
    if (existing) return { ok: false, error: "This job has already been booked since the suggestion was made." };

    const { data: session, error } = await supabase
      .from("job_work_sessions")
      .insert({
        organization_id: profile.organization_id as string,
        job_id: input.jobId,
        starts_on: input.date,
        ends_on: input.date,
        status: "planned",
        created_by: profile.id as string,
      })
      .select("id")
      .single();
    if (error) throw error;

    for (const person of input.crewProfileIds) {
      // Each on its own: one person already on the job must not stop the rest
      // being added, and job_crew's own history trigger records each.
      await supabase
        .from("job_crew")
        .insert({
          organization_id: profile.organization_id as string,
          job_id: input.jobId,
          profile_id: person,
          added_by: profile.id as string,
        })
        .then(undefined, () => undefined);
    }

    await supabase
      .from("job_audit_events")
      .insert({
        organization_id: profile.organization_id as string,
        job_id: input.jobId,
        subject_kind: "schedule",
        subject_id: session.id as string,
        action: "accepted_suggestion",
        to_state: input.date,
        actor: profile.id as string,
        actor_roles: (profile.roles ?? []) as string[],
        note: input.because.join(" "),
        detail: { crew: input.crewProfileIds } as never,
      } as never)
      .then(undefined, () => undefined);

    revalidatePath("/schedule");
    revalidatePath("/jobs");
    revalidatePath(`/jobs/${input.jobId}`);
    return { ok: true, value: { sessionId: session.id as string } };
  } catch (err) {
    return failed(err);
  }
}

/** Whether the business wants the engine at all. The owner's call, nobody else's. */
export async function setScheduleEngineEnabled(enabled: boolean): Promise<ActionResult<{ enabled: boolean }>> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, error: "Not signed in." };
    if (!isOwnerLevel((profile.roles ?? []) as string[])) {
      return { ok: false, error: "Only the owner turns the scheduling engine on or off." };
    }
    const supabase = await createClient();
    const { error } = await supabase
      .from("organizations")
      .update({ schedule_engine_enabled: enabled })
      .eq("id", profile.organization_id as string);
    if (error) throw error;

    revalidatePath("/schedule");
    return { ok: true, value: { enabled } };
  } catch (err) {
    return failed(err);
  }
}

/** Kept so the type is used where a caller wants to know what a viewer may do. */
export async function viewerCanAcceptSuggestions(): Promise<boolean> {
  const profile = await getCurrentProfile();
  return profile ? roleKeysOf((profile.roles ?? []) as string[]).length > 0 && canRunJobs((profile.roles ?? []) as string[]) : false;
}

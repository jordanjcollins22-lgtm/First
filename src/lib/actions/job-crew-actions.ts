"use server";

import { revalidatePath } from "next/cache";

import { describeDbError } from "@/lib/setup-errors";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { notifyTeamMember } from "@/lib/notifications";
import { canAssign, canMakeLead, canUnassign } from "@/lib/job-crew";
import type { JobCrewMember, JobStatus } from "@/types/domain";

export type CrewResult = { ok: true; message?: string } | { ok: false; message: string };

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/attractors");
  revalidatePath("/today");
}

/** The job and its roster, read fresh — decisions are never made on what the
 * page happened to be showing. */
async function loadCrew(supabase: Awaited<ReturnType<typeof createClient>>, jobId: string) {
  const [{ data: job }, { data: crew }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, status, name, properties(address)")
      .eq("id", jobId)
      .single(),
    supabase.from("job_crew").select("*").eq("job_id", jobId),
  ]);
  if (!job) return null;
  return {
    status: job.status as JobStatus,
    label:
      (job as unknown as { properties: { address: string } | null }).properties?.address ?? job.name,
    crew: (crew ?? []) as unknown as JobCrewMember[],
  };
}

/**
 * Puts somebody on the job.
 *
 * The first person on an empty job becomes its lead, so a job never sits with
 * a crew and nobody answering for it. They get a text, because being given a
 * job you find out about by opening the app tomorrow is not being given a job.
 */
export async function assignCrewMember(jobId: string, profileId: string): Promise<CrewResult> {
  try {
    const actor = await getCurrentProfile();
    if (!actor) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const loaded = await loadCrew(supabase, jobId);
    if (!loaded) return { ok: false, message: "Couldn't find that job." };

    // Read the candidate's roles rather than trusting the dropdown that
    // offered them — the rule has to hold against a stale page too.
    const { data: roleRows } = await supabase
      .from("profile_roles")
      .select("role_name")
      .eq("profile_id", profileId);
    const candidate = { roles: ((roleRows ?? []) as { role_name: string }[]).map((r) => r.role_name) };

    const verdict = canAssign(loaded.status, loaded.crew, profileId, candidate);
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const organizationId = await getCurrentOrganizationId();
    const { error } = await supabase.from("job_crew").insert({
      job_id: jobId,
      organization_id: organizationId,
      profile_id: profileId,
      is_lead: loaded.crew.length === 0,
      added_by: actor.id,
    });
    if (error) return { ok: false, message: describeDbError(error) };

    if (profileId !== actor.id) {
      await notifyTeamMember(
        profileId,
        "appointment_reminders",
        `You've been put on ${loaded.label}. It'll show up on your Today screen.`
      ).catch(() => null);
    }

    refresh(jobId);
    return { ok: true, message: "Added to the crew." };
  } catch (err) {
    console.error("assignCrewMember failed:", err);
    return { ok: false, message: "Couldn't add them to this job." };
  }
}

/**
 * Takes somebody off.
 *
 * If they were the lead, the database hands it to whoever has been on the job
 * longest rather than leaving it blank — a job with people on it is not
 * unassigned, and blanking it would drop the job out of every list that
 * filters on assignment.
 */
export async function unassignCrewMember(jobId: string, profileId: string): Promise<CrewResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const loaded = await loadCrew(supabase, jobId);
    if (!loaded) return { ok: false, message: "Couldn't find that job." };

    const verdict = canUnassign(loaded.status, loaded.crew, profileId);
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const { error } = await supabase
      .from("job_crew")
      .delete()
      .eq("job_id", jobId)
      .eq("profile_id", profileId);
    if (error) return { ok: false, message: describeDbError(error) };

    refresh(jobId);
    return { ok: true, message: "Taken off the crew." };
  } catch (err) {
    console.error("unassignCrewMember failed:", err);
    return { ok: false, message: "Couldn't take them off this job." };
  }
}

/** Moves the lead. Done as a clear-then-set because the database allows only
 * one lead per job, and two writes in the wrong order would collide. */
export async function setJobLead(jobId: string, profileId: string): Promise<CrewResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const loaded = await loadCrew(supabase, jobId);
    if (!loaded) return { ok: false, message: "Couldn't find that job." };

    const verdict = canMakeLead(loaded.status, loaded.crew, profileId);
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const { error: clearError } = await supabase
      .from("job_crew")
      .update({ is_lead: false })
      .eq("job_id", jobId)
      .eq("is_lead", true);
    if (clearError) return { ok: false, message: describeDbError(clearError) };

    const { error } = await supabase
      .from("job_crew")
      .update({ is_lead: true })
      .eq("job_id", jobId)
      .eq("profile_id", profileId);
    if (error) return { ok: false, message: describeDbError(error) };

    refresh(jobId);
    return { ok: true, message: "Lead changed." };
  } catch (err) {
    console.error("setJobLead failed:", err);
    return { ok: false, message: "Couldn't change the lead." };
  }
}
